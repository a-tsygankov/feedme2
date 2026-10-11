import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DevicePatch, PairConfirmBody } from "@feedme2/shared";
import { api } from "../lib/api-client.ts";

export const devicesKey = ["devices"] as const;

export function useDevices() {
  // 15 s: last-seen and battery drift while the page is open, but the list is not worth refetching on every mount.
  return useQuery({ queryKey: devicesKey, queryFn: () => api.listDevices().then((r) => r.devices), staleTime: 15_000 });
}

export function useDeviceMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: devicesKey });
  return {
    rename: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: DevicePatch }) => api.patchDevice(id, patch), onSuccess: invalidate }),
    forget: useMutation({ mutationFn: (id: string) => api.deleteDevice(id), onSuccess: invalidate }),
    confirmPair: useMutation({ mutationFn: (body: PairConfirmBody) => api.confirmPair(body), onSuccess: invalidate }),
  };
}
