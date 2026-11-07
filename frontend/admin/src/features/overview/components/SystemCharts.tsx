import { useId, useState } from "react";
import type { AdminRecord } from "@have/shared/api/owner";
import { date, number, text } from "../../../app/hooks";
import { Empty } from "../../../components/ui";
import { percentile, record } from "../../../components/charts";

export function ResourcePillars({ containers }: { containers: AdminRecord[] }) {
  const [metric, setMetric] = useState<"cpu" | "ram">("cpu");
  const value = (row: AdminRecord) => {
    const reading = metric === "cpu" ? row.cpu_percent : row.memory_bytes;
    return typeof reading === "number" && Number.isFinite(reading)
      ? reading / (metric === "ram" ? 1048576 : 1)
      : null;
  };
  const unit = metric === "cpu" ? "%" : " MiB";
  const maximum = Math.max(
    metric === "cpu" ? 100 : 1,
    ...containers.map((row) => value(row) ?? 0),
  );
  const ceiling =
    metric === "cpu" ? Math.ceil(maximum / 100) * 100 : Math.ceil(maximum);
  return (
    <section className="resource-pillars" aria-label="Container resources">
      <div className="resource-heading">
        <h3>Containers</h3>
        <div
          className="resource-switch"
          role="group"
          aria-label="Container resource metric"
        >
          <button
            type="button"
            aria-pressed={metric === "cpu"}
            onClick={() => setMetric("cpu")}
          >
            CPU
          </button>
          <button
            type="button"
            aria-pressed={metric === "ram"}
            onClick={() => setMetric("ram")}
          >
            RAM
          </button>
        </div>
      </div>
      <p className="admin-muted">
        Shared scale · 0–{ceiling}
        {unit}
        {metric === "cpu" && ceiling > 100
          ? " · Docker CPU can exceed 100%"
          : ""}
      </p>
      {containers.length ? (
        <div className="resource-pillar-scroll">
          <div className="resource-pillar-list">
            {containers.map((row) => {
              const reading = value(row);
              const label =
                reading === null
                  ? "Not measured"
                  : `${reading.toFixed(1)}${unit}`;
              return (
                <figure key={String(row.service)} className="resource-pillar">
                  <div
                    className={`resource-pillar-track${reading === null ? " resource-pillar-missing" : ""}`}
                    role="img"
                    aria-label={`${text(row.service)} · ${metric.toUpperCase()}: ${label}`}
                  >
                    {reading !== null && (
                      <div
                        className="resource-pillar-fill"
                        style={{ height: `${(reading / ceiling) * 100}%` }}
                      />
                    )}
                  </div>
                  <figcaption>
                    <strong>{text(row.service)}</strong>
                    <span>{label}</span>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </div>
      ) : (
        <Empty title="No container observations" />
      )}
    </section>
  );
}

export function ApiLatencyChart({
  series,
  range,
  intervalSeconds = 60,
}: {
  series: AdminRecord[];
  range: unknown;
  intervalSeconds?: number;
}) {
  const id = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const start = Date.parse(String(record(range).from ?? series[0]?.minute));
  const end = Date.parse(String(record(range).to ?? series.at(-1)?.minute));
  const duration = Math.max(60_000, end - start);
  const maximum = Math.max(
    1,
    ...series.map((row) => number(record(row.p95).upper)),
  );
  const x = (row: AdminRecord) =>
    38 + ((Date.parse(String(row.minute)) - start) / duration) * 540;
  const y = (row: AdminRecord) =>
    165 - (number(record(row.p95).upper) / maximum) * 135;
  const paths: string[] = [];
  let path = "";
  let previousTime: number | null = null;
  for (const row of series) {
    const timestamp = Date.parse(String(row.minute));
    const metric = record(row.p95);
    if (
      metric.upper === null ||
      metric.upper === undefined ||
      (previousTime !== null &&
        timestamp - previousTime > intervalSeconds * 1000)
    ) {
      if (path) paths.push(path);
      path = "";
    }
    if (typeof metric.upper === "number")
      path += `${path ? "L" : "M"}${x(row)},${y(row)} `;
    previousTime = timestamp;
  }
  if (path) paths.push(path);
  const active = series.find((row) => String(row.minute) === selected);
  const activeMetric = record(active?.p95);
  if (!series.length)
    return <Empty title="No recorded API requests in this window" />;
  return (
    <div
      className="api-latency-chart"
      onPointerLeave={() => {
        if (!pinned) setSelected(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setSelected(null);
          setPinned(false);
        }
      }}
    >
      <svg
        viewBox="0 0 610 205"
        role="group"
        aria-labelledby={id}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const position = ((event.clientX - bounds.left) / bounds.width) * 610;
          const nearest = series.reduce((best, row) =>
            Math.abs(x(row) - position) < Math.abs(x(best) - position)
              ? row
              : best,
          );
          setSelected(String(nearest.minute));
          setPinned(true);
        }}
      >
        <title id={id}>
          API processing time p95. Hover, tap or focus an interval for details.
        </title>
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1="38"
              x2="578"
              y1={165 - fraction * 135}
              y2={165 - fraction * 135}
              className="admin-chart-grid"
            />
            <text x="32" y={169 - fraction * 135} textAnchor="end">
              {Math.round(maximum * fraction)}
            </text>
          </g>
        ))}
        {paths.map((item, index) => (
          <path key={index} d={item} fill="none" className="admin-chart-line" />
        ))}
        {series.map((row) => {
          const label = `${date(row.minute)} · p95 ${percentile(row.p95)} · ${text(record(row.p95).count)} requests`;
          return (
            <g
              key={String(row.minute)}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={selected === row.minute}
              className="latency-point"
              onFocus={() => setSelected(String(row.minute))}
              onPointerEnter={(event) => {
                if (event.pointerType !== "touch" && !pinned)
                  setSelected(String(row.minute));
              }}
              onClick={() => {
                setSelected(String(row.minute));
                setPinned(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelected(String(row.minute));
                  setPinned(true);
                }
              }}
            >
              <rect
                x={x(row) - 7}
                y="20"
                width="14"
                height="150"
                fill="transparent"
              />
              {typeof record(row.p95).upper === "number" && (
                <circle
                  cx={x(row)}
                  cy={y(row)}
                  r={selected === row.minute ? 5 : 3}
                  className="latency-dot"
                />
              )}
            </g>
          );
        })}
        <text x="38" y="192">
          {date(new Date(start).toISOString())}
        </text>
        <text x="578" y="192" textAnchor="end">
          {date(new Date(end).toISOString())}
        </text>
      </svg>
      {active && (
        <div role="status" className="latency-tooltip">
          <span>
            {date(active.minute)} –{" "}
            {date(
              new Date(
                Date.parse(String(active.minute)) + intervalSeconds * 1000,
              ).toISOString(),
            )}{" "}
            · Cairo
          </span>
          <strong>p95 {percentile(activeMetric)}</strong>
          <span>{text(activeMetric.count)} recorded requests</span>
          <button
            type="button"
            aria-label="Close API timing details"
            onClick={() => {
              setSelected(null);
              setPinned(false);
            }}
          >
            ×
          </button>
        </div>
      )}
      <p className="admin-muted">
        Milliseconds · Estimated p95 interval upper edge · Gaps have no
        observation
      </p>
    </div>
  );
}
