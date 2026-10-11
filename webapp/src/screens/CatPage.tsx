import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { Feeding, FeedingCreate, FeedingsPage } from "@feedme2/shared";
import { AppHeader } from "../components/AppHeader.tsx";
import { TabBar } from "../components/TabBar.tsx";
import { Button } from "../components/Button.tsx";
import { FeedSheet } from "../components/FeedSheet.tsx";
import { FeedingRow } from "../components/FeedingRow.tsx";
import { useHouse } from "../hooks/use-house.ts";
import { useCats, catsKey } from "../hooks/use-cats.ts";
import { api } from "../lib/api-client.ts";
import { applyPatch, editPatch, replaceFeeding } from "../lib/feeding-history.ts";
import { syncEngine } from "../lib/sync-engine.ts";

/**
 * Not under the "feedings" key root: the dashboard does
 * setQueriesData({ queryKey: ["feedings"] }) expecting Feeding[] and would
 * choke on the { pages, pageParams } shape of an infinite query.
 */
const historyKey = (catId: string | undefined) => ["feedings-history", catId] as const;

type HistoryData = InfiniteData<FeedingsPage>;
interface Notice { text: string; tone: "info" | "error" }

const SAVED_OFFLINE: Notice = { text: "Saved offline — will sync when online", tone: "info" };
const DROPPED: Notice = { text: "Couldn't save that change", tone: "error" };

export function CatPage() {
  const { id } = useParams<{ id: string }>();
  const house = useHouse();
  const cats = useCats();
  const qc = useQueryClient();
  const cat = cats.data?.find((c) => c.id === id);
  const history = useInfiniteQuery({
    queryKey: historyKey(id),
    queryFn: ({ pageParam }) => api.listFeedings({ cat: id!, limit: 30, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!id,
  });
  const [editing, setEditing] = useState<Feeding | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["feedings"] }),
    qc.invalidateQueries({ queryKey: ["feedings-history"] }),
    qc.invalidateQueries({ queryKey: catsKey }),
  ]);

  /**
   * Drain the outbox, then report what happened: a dropped op (the server refused it) is an error; anything still
   * queued afterwards (offline, a server error, another tab holding the sync lock) is patched into the history
   * cache by hand, because a refetch would just bring the old row back; otherwise refetch.
   * `optimistic` is the feeding as it should look (null = gone from this cat's history).
   * The engine also reports drops with their reason through onDrained (main.tsx shows the banner); this notice is
   * the local, in-context echo of the same event.
   */
  async function settle(feedingId: string, optimistic: Feeding | null) {
    let dropped = 0;
    try {
      dropped = (await syncEngine.drain()).dropped;
    } catch {
      // drain() is not supposed to reject; if it does, the op is still queued, which the check below handles.
    }
    if (dropped > 0) {
      setNotice(DROPPED);
      await refresh();
      return;
    }
    if (syncEngine.getSnapshot().pending > 0) {
      qc.setQueryData<HistoryData>(historyKey(id), (old) => replaceFeeding(old, feedingId, optimistic));
      setNotice(SAVED_OFFLINE);
      return;
    }
    setNotice(null);
    await refresh();
  }

  async function saveEdit(items: FeedingCreate[]) {
    const [item] = items;
    if (!editing || !item) return;
    // Only what the user changed goes out: the sheet's time input has minute precision, so resending an untouched
    // time dropped the seconds, and resending the amount rewrote how it was originally entered.
    const patch = editPatch(editing, item);
    if (Object.keys(patch).length === 0) return;
    const original = editing;
    await syncEngine.enqueue({ kind: "patch", feedingId: original.id, payload: patch });
    // Moving the feeding to another cat takes it out of this cat's history.
    const next = patch.catId !== undefined ? null : applyPatch(original, patch);
    // Not awaited: the sheet closes as soon as the change is safely queued; the notice reports the outcome.
    void settle(original.id, next);
  }

  async function remove(f: Feeding) {
    if (!confirm("Delete this feeding?")) return;
    await syncEngine.enqueue({ kind: "delete", feedingId: f.id, payload: null });
    await settle(f.id, null);
  }

  if (!house.data || !cat) return <p className="p-4 text-sm text-slate-500">{cats.isLoading ? "Loading…" : "No such cat."} <Link to="/" className="underline">Back</Link></p>;
  const settings = house.data.settings;
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="mx-auto min-h-dvh max-w-lg pb-24" data-testid="cat-page">
      <AppHeader />
      <main className="space-y-3 px-4">
        <h2 className="text-xl font-semibold text-slate-900">{cat.name}</h2>
        {notice ? (
          <p className={`text-sm ${notice.tone === "error" ? "text-red-600" : "text-slate-600"}`} role={notice.tone === "error" ? "alert" : "status"} data-testid="history-notice">{notice.text}</p>
        ) : null}
        <ul className="space-y-2" data-testid="feeding-history">
          {items.map((f) => <FeedingRow key={f.id} feeding={f} settings={settings} timeZone={settings.timezone} onEdit={() => setEditing(f)} onDelete={() => void remove(f)} />)}
        </ul>
        {history.isError ? (
          <div className="space-y-2" data-testid="history-error">
            <p className="text-sm text-red-600" role="alert">Couldn't load the history.</p>
            <Button variant="secondary" onClick={() => void history.refetch()} disabled={history.isFetching}>Retry</Button>
          </div>
        ) : null}
        {items.length === 0 && !history.isLoading && !history.isError ? <p className="text-sm text-slate-500" data-testid="history-empty">No feedings yet.</p> : null}
        {history.hasNextPage ? <Button variant="secondary" onClick={() => void history.fetchNextPage()} disabled={history.isFetchingNextPage}>Load more</Button> : null}
      </main>
      {editing ? (
        <FeedSheet house={house.data} cats={cats.data ?? []} initialCatId={editing.catId} editing={editing} onClose={() => setEditing(null)} onSubmit={saveEdit} />
      ) : null}
      <TabBar />
    </div>
  );
}
