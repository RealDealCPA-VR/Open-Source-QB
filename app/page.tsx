"use client";
import { ArrowUpRight, DollarSign, TrendingUp, BarChart2, FileText, BookOpen } from "lucide-react";

const kpiCards = [
  {
    label: "Revenue",
    value: "$2,400,000",
    change: "+8.2%",
    icon: <DollarSign className="h-7 w-7 text-electric" />,
    color: "from-navy to-electric",
    accent: "border-electric"
  },
  {
    label: "Net Profit",
    value: "$890,200",
    change: "+4.1%",
    icon: <TrendingUp className="h-7 w-7 text-emerald" />,
    color: "from-navy to-emerald",
    accent: "border-emerald"
  },
  {
    label: "Cash Flow",
    value: "$1,200,000",
    change: "+2.4%",
    icon: <BarChart2 className="h-7 w-7 text-gold" />,
    color: "from-navy to-gold",
    accent: "border-gold"
  },
  {
    label: "Check Register",
    value: "",
    change: "",
    icon: <FileText className="h-7 w-7 text-electric" />,
    color: "from-electric to-navy",
    accent: "border-electric",
    isCheckRegister: true
  }
];

// Dummy: simulate "accounts" existing. Set to [] to show only plus tile.
// In real app, accounts would come from data fetching/DB.
const accountKpiCards = kpiCards;


export default function HomePage() {
  // If no accounts, only show the plus tile, otherwise show all + plus
  const hasAccounts = accountKpiCards.length > 0;
  return (
    <div className="flex-1 flex flex-col px-4 py-6 md:px-12 bg-offwhite min-h-screen">
      <section>
        <h2 className="font-bold text-3xl mb-4 text-navy tracking-tight font-sans">Executive Dashboard</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-6">
          {(hasAccounts ? accountKpiCards : []).map((kpi) => (
            <div
              key={kpi.label}
              className={`rounded-2xl p-6 bg-gradient-to-br ${kpi.color} border-b-4 ${kpi.accent} shadow-xl flex flex-col items-start group hover:scale-[1.025] transition-all duration-300`}
            >
              <div className="mb-2">{kpi.icon}</div>
              {!kpi.isCheckRegister ? (
                <>
                  <div className="text-2xl font-semibold text-navy tracking-tight font-sans">{kpi.value}</div>
                  <div className="flex items-center gap-1">
                    <ArrowUpRight
                      className={`h-4 w-4 ${
                        kpi.change.startsWith("+") ? "text-electric" : "text-rose-600"
                      }`}
                    />
                    <span
                      className={`text-sm ${
                        kpi.change.startsWith("+") ? "text-electric" : "text-rose-600"
                      }`}
                    >
                      {kpi.change}
                    </span>
                  </div>
                </>
              ) : null}
              <div className="mt-1 text-sm text-navy/50 font-medium">{kpi.label}</div>
            </div>
          ))}
          {/* Plus tile after all */}
          <div className="rounded-2xl p-6 border-2 border-dashed border-electric bg-white flex flex-col items-center justify-center group hover:bg-electric/10 hover:border-solid cursor-pointer transition-all duration-200 min-h-[112px]">
            <div className="flex items-center justify-center rounded-full border-4 border-electric bg-offwhite h-12 w-12 mb-2 transition-all duration-200 group-hover:bg-electric/80">
              <svg width="24" height="24" viewBox="0 0 24 24" stroke="#0095FF" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </div>
            <div className="text-electric font-medium text-base">Add Account</div>
          </div>
        </div>
      </section>
      <section className="mt-12 grid grid-cols-1 xl:grid-cols-3 gap-10">
        <div className="col-span-2 bg-white rounded-2xl shadow-2xl border border-slate-100">
          <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between">
            <h3 className="font-semibold text-xl text-navy">Recent Transactions</h3>
            <div className="flex gap-3 mt-3 md:mt-0">
              <input
                className="px-4 py-2 rounded-full bg-offwhite border border-slate-200 focus:outline-none focus:ring-2 focus:ring-electric"
                placeholder="Search transactions..."
              />
              <select className="px-4 py-2 rounded-full bg-offwhite border border-slate-200 focus:outline-none focus:ring-2 focus:ring-electric appearance-none">
                <option>All Types</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="table-auto w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-gradient-to-r from-offwhite to-white shadow-sm">
                <tr>
                  <th className="py-3 px-4 text-navy/90 text-[15px] text-left font-semibold">Date</th>
                  <th className="py-3 px-4 text-navy/90 text-[15px] text-left font-semibold">Description</th>
                  <th className="py-3 px-4 text-navy/90 text-[15px] text-left font-semibold">Category</th>
                  <th className="py-3 px-4 text-navy/90 text-[15px] text-left font-semibold">Amount</th>
                  <th className="py-3 px-4 text-navy/90 text-[15px] text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5].map((i) => (
                  <tr
                    key={i}
                    className="odd:bg-offwhite even:bg-[#f0f2f7] hover:bg-electric/5 border-b border-slate-100 transition duration-150"
                  >
                    <td className="py-3 px-4 text-navy text-[15px]">2025-11-2{i}</td>
                    <td className="py-3 px-4 text-navy text-[15px]">Vendor Payment</td>
                    <td className="py-3 px-4 text-navy text-[15px]">Supplies</td>
                    <td className="py-3 px-4 text-emerald text-[15px] font-bold">$1,200.00</td>
                    <td className="py-3 px-4">
                      <span className="px-3 py-1 rounded-full bg-emerald/20 text-emerald text-xs font-semibold">
                        Cleared
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 p-6 flex flex-col items-center justify-center min-h-[340px]">
          <h4 className="font-semibold text-xl text-navy">Cash Flow Trend</h4>
          <BarChart2 className="h-24 w-24 text-electric mt-8 mb-2" />
          <p className="text-navy/60">Beautiful financial charts go here</p>
        </div>
      </section>
    </div>
  );
}