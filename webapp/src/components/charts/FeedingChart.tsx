import { BarChart, type BarChartProps } from "./BarChart.tsx";
import { Heatmap, type HeatmapProps } from "./Heatmap.tsx";

export type FeedingChartProps = ({ kind: "bars" } & BarChartProps) | ({ kind: "heatmap" } & HeatmapProps);

/** The spec's `<FeedingChart kind=…>` family: one entry point, one small component per kind. */
export function FeedingChart(props: FeedingChartProps) {
  if (props.kind === "heatmap") {
    const { kind: _kind, ...rest } = props;
    return <Heatmap {...rest} />;
  }
  const { kind: _kind, ...rest } = props;
  return <BarChart {...rest} />;
}
