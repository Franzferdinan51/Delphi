import { useAnimatedNumber } from "../hooks";

const R = 62;
const CX = 75;
const CY = 75;
// 240° sweep: from 150° to 30° going through top? We want a bottom-open gauge.
// Arc from 210° to -30° (i.e. 150° start → sweep 240°), drawn clockwise through the top.
const START_DEG = 150;
const SWEEP_DEG = 240;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number) {
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, startDeg + sweepDeg);
  const large = sweepDeg > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

export function Gauge({ value, size = 150, label = "probability" }: { value: number; size?: number; label?: string }) {
  const display = useAnimatedNumber(value);
  const len = (2 * Math.PI * R * SWEEP_DEG) / 360;
  const frac = Math.max(0, Math.min(100, display)) / 100;
  return (
    <div className="gauge-wrap">
      <svg className="gauge-svg" width={size} height={size * 0.92} viewBox="0 0 150 138">
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#064e3b" />
            <stop offset="55%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#6ee7b7" />
          </linearGradient>
        </defs>
        <path d={arcPath(CX, CY, R, START_DEG, SWEEP_DEG)} fill="none" className="gauge-track" strokeWidth={11} strokeLinecap="round" />
        <path
          d={arcPath(CX, CY, R, START_DEG, SWEEP_DEG)}
          fill="none"
          className="gauge-value"
          strokeWidth={11}
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={len * (1 - frac)}
        />
        <text x={CX} y={CY + 6} textAnchor="middle" className="gauge-num" fontSize={34}>
          {Math.round(display)}
          <tspan fontSize={16} fill="#7d948a">%</tspan>
        </text>
        <text x={CX} y={CY + 28} textAnchor="middle" className="gauge-label">
          {label}
        </text>
      </svg>
    </div>
  );
}
