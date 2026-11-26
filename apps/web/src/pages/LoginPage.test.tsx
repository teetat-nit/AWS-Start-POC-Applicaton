import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { LoginPage } from './LoginPage';

function mockFetch(routes: Record<string, { status: number; body?: unknown }>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes[url] ?? { status: 404, body: { message: 'Not found' } };
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('LoginPage', () => {
  it('shows the Google button only when the API enables it', async () => {
    mockFetch({ '/api/auth/providers': { status: 200, body: { local: true, google: true } } });
    renderPage();
    expect(await screen.findByRole('link', { name: /continue with google/i })).toHaveAttribute(
      'href',
      '/api/auth/google',
    );
  });

  it('hides the Google button when not configured', async () => {
    const fetch = mockFetch({ '/api/auth/providers': { status: 200, body: { local: true, google: false } } });
    renderPage();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /google/i })).not.toBeInTheDocument();
  });

  it('shows the API error on bad credentials', async () => {
    mockFetch({
      '/api/auth/providers': { status: 200, body: { local: true, google: false } },
      '/api/auth/login': { status: 401, body: { message: 'Invalid email or password' } },
    });
    renderPage();
    await userEvent.type(screen.getByLabelText(/email/i), 'a@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });
});
