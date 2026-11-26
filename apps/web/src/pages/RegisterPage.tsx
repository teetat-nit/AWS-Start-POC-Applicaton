import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { AuthCard, FormError, GoogleButton, SubmitButton, TextField } from '../components/AuthCard';
import { useRegister } from '../hooks/useAuth';

export function RegisterPage() {
  const register = useRegister();
  const navigate = useNavigate();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    register.mutate(
      {
        name: String(form.get('name')),
        email: String(form.get('email')),
        password: String(form.get('password')),
      },
      { onSuccess: () => navigate('/', { replace: true }) },
    );
  }

  return (
    <AuthCard
      title="Create account"
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="font-medium text-blue-600 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <FormError message={register.error?.message} />
        <TextField label="Name" name="name" autoComplete="name" />
        <TextField label="Email" name="email" type="email" autoComplete="email" />
        <TextField label="Password (min 8 characters)" name="password" type="password" autoComplete="new-password" minLength={8} />
        <SubmitButton pending={register.isPending}>Create account</SubmitButton>
      </form>
      <GoogleButton />
    </AuthCard>
  );
}
