import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HousePatch } from "@feedme2/shared";
import { api } from "../lib/api-client.ts";
import { authStore } from "../lib/auth-store.ts";

export const houseKey = ["house"] as const;

export function useHouse() {
  const snap = authStore.getSnapshot();
  const query = useQuery({
    queryKey: houseKey,
    queryFn: api.getHouse,
    initialData: snap.status === "signedIn" ? snap.house : undefined,
  });
  // A refetch that changed the house (renamed or re-configured from another phone) must reach the auth snapshot too,
  // or the next cold start shows the stale persisted copy first. Reference check: structural sharing keeps `data`
  // identical to the snapshot's house when nothing changed, so this does not loop. modifiedAt keeps an older persisted
  // cache restore from overwriting a newer snapshot.
  const { data } = query;
  useEffect(() => {
    const cur = authStore.getSnapshot();
    if (data && cur.status === "signedIn" && cur.house.id === data.id && cur.house !== data && data.modifiedAt >= cur.house.modifiedAt) authStore.updateHouse(data);
  }, [data]);
  return query;
}

export function usePatchHouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: HousePatch) => api.patchHouse(patch),
    onSuccess: (house) => { qc.setQueryData(houseKey, house); authStore.updateHouse(house); },
  });
}
