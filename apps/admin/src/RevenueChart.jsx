// Split out of App.jsx purely so `recharts` (the single reason this app
// tripped Rollup's >500kB chunk warning) loads as its own chunk, fetched
// only when the Analytics tab is actually opened, instead of being part
// of the bundle every admin downloads on first load. See App.jsx —
// AnalyticsPage lazy-imports this via React.lazy/Suspense rather than a
// normal top-level import.
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export default function RevenueChart({ trend, tealColor, inkFaintColor, formatTZS }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={trend}>
        <XAxis dataKey="date" tick={{ fontSize: 12, fill: inkFaintColor }} axisLine={false} tickLine={false} />
        <YAxis hide />
        <Tooltip contentStyle={{ borderRadius: 12, border: "none" }} formatter={(v) => formatTZS(v)} />
        <Line type="monotone" dataKey="revenue" stroke={tealColor} strokeWidth={3} dot={{ fill: tealColor, r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
