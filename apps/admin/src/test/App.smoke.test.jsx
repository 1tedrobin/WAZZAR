import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

// This app previously had NO test framework at all (see
// docs/delivery-notes/MASTER_GAPS_AND_ROADMAP.md, "No test framework in
// admin/business"). Mirrors the pattern already used in
// apps/customer/src/test/App.smoke.test.jsx and
// apps/rider/src/test/App.smoke.test.jsx: render the real App, drive it
// through its login screen with real user interactions, and only mock
// the network-calling api functions — everything else (currentUser,
// isAuthenticated, roleSummary, logout) is the REAL implementation from
// api.js, reading/writing the same localStorage keys it does in
// production. That way a bug like "the login screen calls a prop that
// doesn't exist" or "the dashboard reads the wrong field off the user
// object" gets caught here, not just a passing `vite build`.
const TOKEN_KEY = 'wazzar_admin_access_token';
const REFRESH_KEY = 'wazzar_admin_refresh_token';
const USER_KEY = 'wazzar_admin_user';

vi.mock('../api', async () => {
  const actual = await vi.importActual('../api');
  return {
    ...actual,
    // Real login() calls fetch() via request() — replaced here with a
    // fake network response, but it still writes the exact same
    // localStorage keys the real setSession() does, so the *unmocked*
    // currentUser()/isAuthenticated()/roleSummary() below behave
    // identically to production once this resolves.
    login: vi.fn(async (phone) => {
      const result = {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        user: { id: 'admin-1', fullName: 'Test Admin', phone, roles: ['ADMIN'] },
      };
      localStorage.setItem(TOKEN_KEY, result.accessToken);
      localStorage.setItem(REFRESH_KEY, result.refreshToken);
      localStorage.setItem(USER_KEY, JSON.stringify(result.user));
      return result;
    }),
    // The dispatch dashboard (this app's default/first page) loads this
    // on mount — an empty queue is enough to reach the real page content.
    getDispatchQueue: vi.fn(async () => ({ pendingShipments: [], onlineRiders: [] })),
  };
});

describe('Admin app — login critical path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders the login screen first', () => {
    render(<App />);
    expect(screen.getByText('WAZZAR Admin')).toBeInTheDocument();
    expect(screen.getByText('Sign in')).toBeInTheDocument();
  });

  it('walks Login → Dispatch dashboard, actually calling the real api module', async () => {
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText('+255712345678'), {
      target: { value: '+255700000001' },
    });
    // Password field has no placeholder in the real form — select it by
    // its Field label instead, same as a real user tabbing through the form.
    const passwordInput = document.querySelector('input[type="password"]');
    fireEvent.change(passwordInput, { target: { value: 'correct-horse-battery-staple' } });

    fireEvent.click(screen.getByText('Sign in'));

    const api = await import('../api');
    await waitFor(() =>
      expect(api.login).toHaveBeenCalledWith('+255700000001', 'correct-horse-battery-staple'),
    );

    // Reaching the dispatch dashboard's real (non-mocked) empty-state
    // copy confirms the whole chain ran: login resolved, the real
    // currentUser()/isAuthenticated()/roleSummary() read the session
    // back out of localStorage correctly, AppShell rendered, and
    // DispatchPage's real api.getDispatchQueue() call resolved.
    await waitFor(() => expect(screen.getByText('Pending shipments')).toBeInTheDocument());
    expect(screen.getByText('Nothing waiting on dispatch.')).toBeInTheDocument();
    expect(screen.getByText('No riders currently online.')).toBeInTheDocument();
  });
});
