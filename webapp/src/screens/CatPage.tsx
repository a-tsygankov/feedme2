import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { Feeding, FeedingCreate } from "@feedme2/shared";
import { AppHeader } from "../components/AppHeader.tsx";
import { TabBar } from "../components/TabBar.tsx";
import { Button } from "../components/Button.tsx";
import { FeedSheet } from "../components/FeedSheet.tsx";
import { FeedingRow } from "../components/FeedingRow.tsx";
import { useHouse } from "../hooks/use-house.ts";
import { useCats, catsKey } from "../hooks/use-cats.ts";
import { api } from "../lib/api-client.ts";
import { syncEngine } from "../lib/sync-engine.ts";

/**
 * Not under the "feedings" key root: the dashboard does
 * setQueriesData({ queryKey: ["feedings"] }) expecting Feeding[] and would
 * choke on the { pages, pageParams } shape of an infinite query.
 */
const historyKey = (catId: string | undefined) => ["feedings-history", catId] as const;

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

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["feedings"] }),
    qc.invalidateQueries({ queryKey: ["feedings-history"] }),
    qc.invalidateQueries({ queryKey: catsKey }),
  ]);

  async function saveEdit(items: FeedingCreate[]) {
    const [item] = items;
    if (!editing || !item) return;
    // The server needs the three amount fields together (FeedingPatchSchema), so send them as one unit.
    await syncEngine.enqueue({
      kind: "patch", feedingId: editing.id,
      payload: { catId: item.catId, fedAt: item.fedAt, amountMg: item.amountMg, enteredUnit: item.enteredUnit, enteredValue: item.enteredValue, note: item.note ?? null },
    });
    const r = await syncEngine.drain();
    if (!r.stopped) await refresh();
  }

  async function remove(f: Feeding) {
    if (!confirm("Delete this feeding?")) return;
    await syncEngine.enqueue({ kind: "delete", feedingId: f.id, payload: null });
    const r = await syncEngine.drain();
    if (!r.stopped) await refresh();
  }

  if (!house.data || !cat) return <p className="p-4 text-sm text-slate-500">{cats.isLoading ? "Loading…" : "No such cat."} <Link to="/" className="underline">Back</Link></p>;
  const settings = house.data.settings;
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="mx-auto min-h-dvh max-w-lg pb-24" data-testid="cat-page">
      <AppHeader />
      <main className="space-y-3 px-4">
        <h2 className="text-xl font-semibold text-slate-900">{cat.name}</h2>
        <p className="text-sm text-slate-500">Charts arrive in Phase 4. History:</p>
        <ul className="space-y-2" data-testid="feeding-history">
          {items.map((f) => <FeedingRow key={f.id} feeding={f} settings={settings} onEdit={() => setEditing(f)} onDelete={() => void remove(f)} />)}
        </ul>
        {items.length === 0 && !history.isLoading ? <p className="text-sm text-slate-500" data-testid="history-empty">No feedings yet.</p> : null}
        {history.hasNextPage ? <Button variant="secondary" onClick={() => void history.fetchNextPage()} disabled={history.isFetchingNextPage}>Load more</Button> : null}
      </main>
      {editing ? (
        <FeedSheet house={house.data} cats={cats.data ?? []} initialCatId={editing.catId} editing={editing} onClose={() => setEditing(null)} onSubmit={saveEdit} />
      ) : null}
      <TabBar />
    </div>
  );
}
