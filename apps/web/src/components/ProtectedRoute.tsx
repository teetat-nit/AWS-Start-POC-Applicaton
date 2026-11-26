import { Navigate, Outlet, useLocation } from 'react-router';
import { useCurrentUser } from '../hooks/useAuth';
import { FullPageMessage } from './FullPageMessage';

/** Renders child routes only for signed-in users; otherwise redirects to /login. */
export function ProtectedRoute() {
  const { data: user, isPending, isError } = useCurrentUser();
  const location = useLocation();

  if (isPending) return <FullPageMessage>Loading…</FullPageMessage>;
  if (isError) return <FullPageMessage>Could not reach the server. Please try again.</FullPageMessage>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** Inverse of ProtectedRoute: sends signed-in users away from /login and /register. */
export function GuestRoute() {
  const { data: user, isPending } = useCurrentUser();
  if (isPending) return <FullPageMessage>Loading…</FullPageMessage>;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}
