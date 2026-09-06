// Split out of App.jsx purely so `recharts` loads as its own chunk,
// fetched only when the Analytics page is actually opened — same
// reasoning as DeliveriesChart.jsx (which preloads on login, since
// Overview is the default landing page) and the admin app's
// RevenueChart.jsx (which, like this one, loads fully on demand since
// Analytics isn't the default page here either). See App.jsx —
// AnalyticsPage lazy-imports these via React.lazy/Suspense.
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

export function AnalyticsTrendChart({ dailySeries, tealColor, coralColor, inkFaintColor, paperDimColor, formatTZS }) {
  const data = dailySeries.map((d) => ({ ...d, label: d.date.slice(5) }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data}>
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: inkFaintColor }} axisLine={false} tickLine={false} />
        <YAxis yAxisId="shipments" hide allowDecimals={false} />
        <YAxis yAxisId="spend" orientation="right" hide />
        <Tooltip
          cursor={{ fill: paperDimColor }}
          contentStyle={{ borderRadius: 12, border: "none" }}
          formatter={(value, name) => (name === "Spend" ? formatTZS(value) : value)}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="shipments" dataKey="shipments" name="Deliveries" fill={tealColor} radius={[6, 6, 0, 0]} />
        <Line yAxisId="spend" type="monotone" dataKey="spend" name="Spend" stroke={coralColor} strokeWidth={2.5} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
