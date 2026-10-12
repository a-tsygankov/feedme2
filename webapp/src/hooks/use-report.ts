import { useQuery } from "@tanstack/react-query";
import type { ReportBucket } from "@feedme2/shared";
import { api } from "../lib/api-client.ts";
import { chartBucket, type ReportFilters } from "../lib/report-filters.ts";

/**
 * Not under the "feedings" key root: the dashboard does setQueriesData({ queryKey: ["feedings"] }) expecting
 * Feeding[] and would choke on a ReportSummary. `unit` is not in the key: it only changes how the numbers read.
 */
export const reportKey = (f: Pick<ReportFilters, "from" | "to" | "cat">, bucket: ReportBucket) => ["report", f.from, f.to, f.cat, bucket] as const;

/** One ReportSummary per range, cat and bucket. chartBucket only asks for hours on a one-day range. */
export function useReport(f: ReportFilters) {
  const bucket = chartBucket(f);
  return useQuery({
    queryKey: reportKey(f, bucket),
    queryFn: () => api.reportSummary({ from: f.from, to: f.to, bucket, ...(f.cat !== null ? { cat: f.cat } : {}) }),
    staleTime: 60_000,
  });
}
