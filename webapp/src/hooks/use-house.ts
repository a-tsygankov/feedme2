import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HousePatch } from "@feedme2/shared";
import { api } from "../lib/api-client.ts";
import { authStore } from "../lib/auth-store.ts";

export const houseKey = ["house"] as const;

export function useHouse() {
  const snap = authStore.getSnapshot();
  return useQuery({
    queryKey: houseKey,
    queryFn: api.getHouse,
    initialData: snap.status === "signedIn" ? snap.house : undefined,
  });
}

export function usePatchHouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: HousePatch) => api.patchHouse(patch),
    onSuccess: (house) => { qc.setQueryData(houseKey, house); authStore.updateHouse(house); },
  });
}
