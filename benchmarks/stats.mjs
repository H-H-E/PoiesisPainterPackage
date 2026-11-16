/** Descriptive statistics only; never use a single fastest run as a headline. */
export function percentile(values, p) {
  if (!values.length || !values.every(Number.isFinite) || p < 0 || p > 100) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * p / 100;
  const low = Math.floor(rank), high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

const rounded = n => n === null ? null : Math.round(n * 1000) / 1000;

export function summarize(values) {
  if (!values.length || !values.every(Number.isFinite)) return null;
  const median = percentile(values, 50);
  const mean = values.reduce((sum, x) => sum + x, 0) / values.length;
  const deviations = values.map(x => Math.abs(x - median));
  const variance = values.length > 1
    ? values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (values.length - 1)
    : 0;
  return {
    n: values.length, median: rounded(median), p95: rounded(percentile(values, 95)),
    min: rounded(Math.min(...values)), max: rounded(Math.max(...values)),
    mean: rounded(mean), sampleStddev: rounded(Math.sqrt(variance)),
    medianAbsoluteDeviation: rounded(percentile(deviations, 50)),
    iqr: rounded(percentile(values, 75) - percentile(values, 25)),
  };
}
