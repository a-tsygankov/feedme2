import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Cat, Feeding, FeedingCreate } from "@feedme2/shared";
import { CatCard } from "../components/CatCard.tsx";
import { FeedSheet } from "../components/FeedSheet.tsx";
import { Button } from "../components/Button.tsx";
import { useHouse } from "../hooks/use-house.ts";
import { useCats, catsKey } from "../hooks/use-cats.ts";
import { useFeedingsSince } from "../hooks/use-feedings.ts";
import { useNow } from "../hooks/use-now.ts";
import { startOfDayInZone } from "../lib/day-boundary.ts";
import { buildFeedItems } from "../lib/feed-items.ts";
import { syncEngine } from "../lib/sync-engine.ts";
import { appLog } from "../lib/logger.ts";

export function Dashboard() {
  const house = useHouse();
  const cats = useCats();
  const now = useNow();
  const qc = useQueryClient();
  // Narrowing of house.data does not survive into the closures below.
  const h = house.data;
  // "Today" is the house's calendar day, so every phone in the house agrees on it.
  const timeZone = h?.settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dayStart = useMemo(() => startOfDayInZone(now, timeZone), [now, timeZone]);
  const todays = useFeedingsSince(dayStart);
  const [sheet, setSheet] = useState<{ catId: string | undefined } | null>(null);

  /** Queue, show optimistically, and return: the network part runs in the background so a slow or absent connection never holds the sheet open. */
  async function record(items: FeedingCreate[], houseId: string) {
    const at = Date.now();
    // Outbox first: a feeding logged with no network must survive a reload.
    for (const item of items) await syncEngine.enqueue({ kind: "create", feedingId: item.id, payload: item });
    // Optimistic: the cat's ring and today's list move immediately.
    qc.setQueryData<Cat[]>(catsKey, (old) => old?.map((c) => {
      const mine = items.filter((i) => i.catId === c.id).sort((a, b) => b.fedAt - a.fedAt)[0];
      return mine && (c.lastFedAt ?? 0) <= mine.fedAt
        ? { ...c, lastFedAt: mine.fedAt, defaultAmountMg: mine.amountMg, defaultEnteredUnit: mine.enteredUnit, defaultEnteredValue: mine.enteredValue, modifiedAt: at }
        : c;
    }));
    // Every ["feedings", ...] cache (exact: false) is a Feeding[]. The Array.isArray guard keeps this from ever
    // touching a differently shaped cache (the CatPage history is an infinite query, { pages, pageParams }, under
    // its own "feedings-history" root): spreading one of those would corrupt it.
    qc.setQueriesData<Feeding[]>({ queryKey: ["feedings"], exact: false }, (old) => (Array.isArray(old) ? [
      ...items.map((i): Feeding => ({ ...i, houseId, source: "web", deviceId: null, clientId: null, note: i.note ?? null, createdAt: at, modifiedAt: at })),
      ...old,
    ] : old));
    appLog.info("feedings queued", { count: items.length });
    void flush();
  }

  async function flush() {
    try {
      const r = await syncEngine.drain();
      if (!r.stopped) await Promise.all([qc.invalidateQueries({ queryKey: catsKey }), qc.invalidateQueries({ queryKey: ["feedings"] })]);
    } catch (err) {
      appLog.warn("feeding sync failed", { message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Spec §4.3: one tap on "Feed 40 g" logs the cat's default amount right now. */
  async function quickFeed(cat: Cat) {
    if (!h || !cat.defaultAmountMg) return;
    const items = buildFeedItems({
      cats: [cat], catId: cat.id, mg: cat.defaultAmountMg, fedAt: Date.now(),
      unit: h.settings.foodUnit, settings: h.settings, note: "", ids: () => crypto.randomUUID(),
    });
    await record(items, h.id);
  }

  return (
    <main className="space-y-3 px-4" data-testid="dashboard">
      {cats.isError && !cats.data ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center" role="alert" data-testid="cats-error">
          <p className="text-slate-700">Couldn't load your cats.</p>
          <Button className="mt-3" onClick={() => void cats.refetch()} data-testid="cats-retry">Retry</Button>
        </div>
      ) : null}
      {(cats.isLoading || !house.data) && !cats.isError ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {cats.data?.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center" data-testid="empty-cats">
          <p className="text-slate-700">No cats yet.</p>
          <Link to="/settings#cats" className="mt-3 inline-block"><Button>Add a cat</Button></Link>
        </div>
      ) : null}
      {h && cats.data?.map((cat) => (
        <CatCard key={cat.id} cat={cat} house={h} nowMs={now}
          // Also bounded by dayStart: after midnight keepPreviousData briefly serves yesterday's list.
          todays={todays.data?.filter((f) => f.catId === cat.id && f.fedAt >= dayStart)}
          onFeed={() => setSheet({ catId: cat.id })} onQuickFeed={() => quickFeed(cat)} />
      ))}
      {h && (cats.data?.length ?? 0) >= 2 ? (
        <Button variant="secondary" className="w-full" onClick={() => setSheet({ catId: undefined })} data-testid="feed-all">Feed all</Button>
      ) : null}
      {sheet && h && cats.data ? (
        <FeedSheet house={h} cats={cats.data} initialCatId={sheet.catId} onClose={() => setSheet(null)} onSubmit={(items) => record(items, h.id)} />
      ) : null}
    </main>
  );
}
