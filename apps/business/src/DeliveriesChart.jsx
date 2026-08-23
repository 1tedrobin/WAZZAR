// Split out of App.jsx purely so `recharts` (the single reason this app
// tripped Rollup's >500kB chunk warning) loads as its own chunk instead of
// shipping in the main bundle. Unlike the admin app's RevenueChart (which
// sits behind an Analytics tab and only loads on demand), this chart lives
// on OverviewPage — the default landing page here — so App.jsx also calls
// `preloadDeliveriesChart()` as soon as a session is confirmed, to start
// fetching this chunk in the background during the profile/orders load
// that already happens on login, instead of waiting for OverviewPage to
// mount and request it cold. See App.jsx — OverviewPage lazy-imports this
// via React.lazy/Suspense rather than a normal top-level import.
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export default function DeliveriesChart({ chartData, tealColor, inkFaintColor, paperDimColor }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData}>
        <XAxis dataKey="day" tick={{ fontSize: 12, fill: inkFaintColor }} axisLine={false} tickLine={false} />
        <YAxis hide allowDecimals={false} />
        <Tooltip cursor={{ fill: paperDimColor }} contentStyle={{ borderRadius: 12, border: "none" }} />
        <Bar dataKey="deliveries" fill={tealColor} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
