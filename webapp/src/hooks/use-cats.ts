import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Cat, CatCreate, CatPatch } from "@feedme2/shared";
import { api } from "../lib/api-client.ts";

export const catsKey = ["cats"] as const;

export function useCats() {
  return useQuery({ queryKey: catsKey, queryFn: api.listCats });
}

export function useCatMutations() {
  const qc = useQueryClient();
  // Reports too: they carry each cat's name and colour and mark a removed one, so any cat change makes them stale.
  const invalidate = () => Promise.all([qc.invalidateQueries({ queryKey: catsKey }), qc.invalidateQueries({ queryKey: ["report"] })]);
  return {
    create: useMutation({ mutationFn: (input: CatCreate) => api.createCat(input), onSuccess: invalidate }),
    patch: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: CatPatch }) => api.patchCat(id, patch), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => api.deleteCat(id), onSuccess: invalidate }),
  };
}

export function upsertCatInCache(qc: ReturnType<typeof useQueryClient>, cat: Cat): void {
  qc.setQueryData<Cat[]>(catsKey, (old) => (old ? old.map((c) => (c.id === cat.id ? cat : c)) : [cat]));
}
