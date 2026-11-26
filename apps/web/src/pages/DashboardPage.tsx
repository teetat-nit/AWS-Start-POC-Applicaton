import { useNavigate } from 'react-router';
import { useCurrentUser, useLogout } from '../hooks/useAuth';

export function DashboardPage() {
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const navigate = useNavigate();

  if (!user) return null; // ProtectedRoute guarantees a user; this narrows the type.

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="font-semibold">AWS Start POC</span>
          <div className="flex items-center gap-3">
            {user.avatarUrl && (
              <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />
            )}
            <span className="text-sm text-slate-600">{user.email}</span>
            <button
              type="button"
              onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) })}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
        <p className="mt-2 text-slate-600">You are signed in. Build your features from here.</p>

        <dl className="mt-8 grid gap-4 sm:grid-cols-3">
          <Stat label="User ID" value={user.id} />
          <Stat label="Sign-in methods" value={user.providers.join(', ')} />
          <Stat label="Member since" value={new Date(user.createdAt).toLocaleDateString()} />
        </dl>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 truncate font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}
