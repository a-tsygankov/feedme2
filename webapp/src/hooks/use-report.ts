import { useQuery } from "@tanstack/react-query";
import type { ReportBucket } from "@feedme2/shared";
import { api } from "../lib/api-client.ts";
import { chartBucket, type ReportFilters } from "../lib/report-filters.ts";

/**
 * Not under the "feedings" key root: the dashboard does setQueriesData({ queryKey: ["feedings"] }) expecting
 * Feeding[] and would choke on a ReportSummary. `unit` is not in the key: it only changes how the numbers read.
 * The house zone is: the server buckets in it, and without it a zone change kept serving the old zone's days from
 * the same key (and the persisted cache). Unit and can-size changes are covered by usePatchHouse invalidating "report".
 */
export const reportKey = (f: Pick<ReportFilters, "from" | "to" | "cat">, bucket: ReportBucket, timeZone: string) =>
  ["report", timeZone, f.from, f.to, f.cat, bucket] as const;

/** One ReportSummary per zone, range, cat and bucket. chartBucket only asks for hours on a one-day range. */
export function useReport(f: ReportFilters, timeZone: string) {
  const bucket = chartBucket(f);
  return useQuery({
    queryKey: reportKey(f, bucket, timeZone),
    queryFn: () => api.reportSummary({ from: f.from, to: f.to, bucket, ...(f.cat !== null ? { cat: f.cat } : {}) }),
    staleTime: 60_000,
  });
}
