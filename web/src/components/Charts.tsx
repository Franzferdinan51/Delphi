interface Pt {
  x: number;
  y: number;
  tip?: string;
}

interface LineChartProps {
  points: Pt[];
  yMin?: number;
  yMax?: number;
  yTicks?: number[];
  yFormat?: (v: number) => string;
  xLabels?: string[];
  height?: number;
  color?: string;
  fillArea?: boolean;
}

const W = 680;
const PAD = { l: 52, r: 16, t: 16, b: 40 };

export function LineChart({
  points,
  yMin,
  yMax,
  yTicks,
  yFormat = (v) => v.toFixed(2),
  xLabels,
  height = 280,
  color = "#34d399",
  fillArea = true,
}: LineChartProps) {
  const H = height;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;

  const ys = points.map((p) => p.y);
  const lo = yMin ?? Math.min(...ys, 0);
  let hi = yMax ?? Math.max(...ys);
  if (hi === lo) hi = lo + 1;

  const X = (i: number) => (points.length === 1 ? PAD.l + iw / 2 : PAD.l + (i / (points.length - 1)) * iw);
  const Y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;

  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${X(i).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(" ");
  const area = `${d} L ${X(points.length - 1).toFixed(1)} ${(PAD.t + ih).toFixed(1)} L ${X(0).toFixed(1)} ${(PAD.t + ih).toFixed(1)} Z`;

  const ticks = yTicks ?? [0, 1, 2, 3, 4].map((i) => lo + ((hi - lo) * i) / 4);

  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} y1={Y(t)} x2={W - PAD.r} y2={Y(t)} className="grid-line" />
          <text x={PAD.l - 10} y={Y(t) + 4} textAnchor="end" fontSize={11} fill="#4c6157">
            {yFormat(t)}
          </text>
        </g>
      ))}
      {points.map((p, i) => (
        <text
          key={`x${i}`}
          x={X(i)}
          y={H - 12}
          textAnchor="middle"
          fontSize={11}
          fill="#4c6157"
        >
          {xLabels?.[i] ?? p.x}
        </text>
      ))}
      {fillArea && <path d={area} fill={color} opacity={0.08} />}
      <path d={d} className="trend-line" style={{ stroke: color }} />
      {points.map((p, i) => (
        <g key={i}>
          <title>{p.tip ?? `${p.x}: ${yFormat(p.y)}`}</title>
          <circle cx={X(i)} cy={Y(p.y)} r={5.5} className="dot" style={{ fill: color }} />
        </g>
      ))}
    </svg>
  );
}

interface BucketPt {
  x: number; // avg forecast 0-100
  y: number; // hit rate 0-100
  n: number;
  label: string;
}

export function CalibrationPlot({ buckets }: { buckets: BucketPt[] }) {
  const W2 = 560;
  const H2 = 440;
  const p = { l: 52, r: 20, t: 20, b: 52 };
  const iw = W2 - p.l - p.r;
  const ih = H2 - p.t - p.b;
  const X = (v: number) => p.l + (v / 100) * iw;
  const Y = (v: number) => p.t + ih - (v / 100) * ih;
  const maxN = Math.max(1, ...buckets.map((b) => b.n));

  return (
    <svg className="chart-svg" viewBox={`0 0 ${W2} ${H2}`} role="img">
      {/* grid + axes */}
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={X(v)} y1={p.t} x2={X(v)} y2={p.t + ih} className="grid-line" />
          <line x1={p.l} y1={Y(v)} x2={p.l + iw} y2={Y(v)} className="grid-line" />
          <text x={X(v)} y={H2 - 32} textAnchor="middle" fontSize={11} fill="#4c6157">
            {v}%
          </text>
          <text x={p.l - 10} y={Y(v) + 4} textAnchor="end" fontSize={11} fill="#4c6157">
            {v}%
          </text>
        </g>
      ))}
      <line x1={X(0)} y1={Y(0)} x2={X(100)} y2={Y(100)} className="perfect-line" />
      <text x={W2 - p.r} y={p.t + 4} textAnchor="end" fontSize={11} fill="#4c6157">
        perfect calibration
      </text>
      <text x={p.l + iw / 2} y={H2 - 8} textAnchor="middle" fontSize={12} fill="#7d948a">
        forecast probability
      </text>
      <text x={14} y={p.t + ih / 2} textAnchor="middle" fontSize={12} fill="#7d948a" transform={`rotate(-90 14 ${p.t + ih / 2})`}>
        observed hit rate
      </text>
      {buckets.map((b, i) => {
        const r = 5 + Math.sqrt(b.n / maxN) * 11;
        return (
          <g key={i}>
            <title>
              {b.label}: forecast {b.x.toFixed(0)}% → hit rate {b.y.toFixed(0)}% (n={b.n})
            </title>
            <circle cx={X(b.x)} cy={Y(b.y)} r={r} fill="#34d399" opacity={0.75} stroke="#03130d" strokeWidth={2} />
            <text x={X(b.x)} y={Y(b.y) - r - 6} textAnchor="middle" fontSize={10.5} fill="#7d948a" fontFamily="IBM Plex Mono, monospace">
              n={b.n}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
