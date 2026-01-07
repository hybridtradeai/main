import { useEffect, useState } from 'react';
import AdminGuard from '../../components/AdminGuard';
import { supabase } from '../../lib/supabase';

type Plan = {
  id: string;
  name: string;
  returnPercentage: number;
  minAmount: number;
  maxAmount: number;
  duration: number;
  payoutFrequency: string;
  active: boolean;
};

export default function AdminPlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [edit, setEdit] = useState<Plan | null>(null);

  async function fetchPlans() {
    setLoading(true);
    // Use InvestmentPlan table (PascalCase)
    const { data, error } = await supabase.from('InvestmentPlan').select('*').order('minAmount', { ascending: true });
    if (error) {
        // Fallback to lowercase if PascalCase fails (though check-plan.js confirmed PascalCase)
        console.error('Error fetching InvestmentPlan:', error);
        const { data: data2, error: error2 } = await supabase.from('investment_plans').select('*').order('min_amount', { ascending: true });
        if (error2) console.error('Error fetching investment_plans:', error2);
        else {
             // Map snake_case to camelCase
             setPlans((data2 || []).map((p: any) => ({
                 id: p.id,
                 name: p.name,
                 returnPercentage: p.return_percentage || p.weekly_roi || 0,
                 minAmount: p.min_amount || 0,
                 maxAmount: p.max_amount || 0,
                 duration: p.duration || 0,
                 payoutFrequency: p.payout_frequency || 'WEEKLY',
                 active: p.active
             })));
        }
    } else {
        setPlans((data as any) || []);
    }
    setLoading(false);
  }

  async function savePlan(p: Plan) {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return setMsg('Session lost');
    try {
      const res = await fetch('/api/admin/plans', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(p),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setMsg('Plan saved');
      setEdit(null);
      fetchPlans();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  useEffect(() => {
    fetchPlans();
  }, []);

  return (
    <AdminGuard>
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-4 text-foreground">Investment Plans</h1>
        {msg && <p className="mb-2 text-sm text-blue-500">{msg}</p>}
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        <div className="overflow-auto border border-border rounded-lg">
          <table className="min-w-full table-auto text-sm text-foreground">
            <thead>
              <tr className="bg-muted text-muted-foreground">
                <th className="px-2 py-1 text-left font-medium">Name</th>
                <th className="px-2 py-1 text-left font-medium">ROI %</th>
                <th className="px-2 py-1 text-left font-medium">Min</th>
                <th className="px-2 py-1 text-left font-medium">Max</th>
                <th className="px-2 py-1 text-left font-medium">Duration</th>
                <th className="px-2 py-1 text-left font-medium">Freq</th>
                <th className="px-2 py-1 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/50 transition-colors">
                  <td className="px-2 py-1">{p.name}</td>
                  <td className="px-2 py-1">{p.returnPercentage}%</td>
                  <td className="px-2 py-1">{p.minAmount}</td>
                  <td className="px-2 py-1">{p.maxAmount}</td>
                  <td className="px-2 py-1">{p.duration} days</td>
                  <td className="px-2 py-1">{p.payoutFrequency}</td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      onClick={() => setEdit(p)}
                      className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:opacity-90 transition-opacity"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {edit && (
          <div className="mt-6 p-4 border border-border rounded bg-muted/30">
            <h2 className="text-lg font-medium mb-2 text-foreground">Edit {edit.name}</h2>
            <label className="block text-sm mb-1 text-foreground">ROI %</label>
            <input
              type="number"
              step="0.01"
              className="w-full border border-border rounded p-2 mb-2 bg-background text-foreground"
              value={edit.returnPercentage}
              onChange={(e) => setEdit({ ...edit, returnPercentage: parseFloat(e.target.value) })}
            />
            <label className="block text-sm mb-1 text-foreground">Min Amount</label>
            <input
              type="number"
              className="w-full border border-border rounded p-2 mb-2 bg-background text-foreground"
              value={edit.minAmount}
              onChange={(e) => setEdit({ ...edit, minAmount: parseFloat(e.target.value) })}
            />
            <label className="block text-sm mb-1 text-foreground">Max Amount</label>
            <input
              type="number"
              className="w-full border border-border rounded p-2 mb-2 bg-background text-foreground"
              value={edit.maxAmount}
              onChange={(e) => setEdit({ ...edit, maxAmount: parseFloat(e.target.value) })}
            />
            <label className="block text-sm mb-1 text-foreground">Duration (days)</label>
            <input
              type="number"
              className="w-full border border-border rounded p-2 mb-2 bg-background text-foreground"
              value={edit.duration}
              onChange={(e) => setEdit({ ...edit, duration: parseInt(e.target.value) })}
            />
             <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => savePlan(edit)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEdit(null)}
                className="px-4 py-2 border border-border rounded hover:bg-muted transition-colors text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminGuard>
  );
}
