import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { AuthCard, FormError, GoogleButton, SubmitButton, TextField } from '../components/AuthCard';
import { useLogin } from '../hooks/useAuth';

export function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';
  const googleError = params.get('error') === 'google' ? 'Google sign-in failed. Please try again.' : null;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    login.mutate(
      { email: String(form.get('email')), password: String(form.get('password')) },
      { onSuccess: () => navigate(redirectTo, { replace: true }) },
    );
  }

  return (
    <AuthCard
      title="Sign in"
      footer={
        <>
          No account?{' '}
          <Link to="/register" className="font-medium text-blue-600 hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <FormError message={login.error?.message ?? googleError} />
        <TextField label="Email" name="email" type="email" autoComplete="email" />
        <TextField label="Password" name="password" type="password" autoComplete="current-password" />
        <SubmitButton pending={login.isPending}>Sign in</SubmitButton>
      </form>
      <GoogleButton />
    </AuthCard>
  );
}
