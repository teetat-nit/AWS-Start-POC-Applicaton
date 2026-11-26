import type { ReactNode } from 'react';

export function FullPageMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-500" role="status">
      {children}
    </div>
  );
}
