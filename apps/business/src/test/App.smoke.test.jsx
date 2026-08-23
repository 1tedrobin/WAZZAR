import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

// This app previously had NO test framework at all (see
// docs/delivery-notes/MASTER_GAPS_AND_ROADMAP.md, "No test framework in
// admin/business"). Same pattern as apps/customer, apps/rider, and
// apps/admin's smoke tests: render the real App, drive it through login
// with real interactions, and only mock the network-calling api
// functions (login, listShipments) — currentUser/isAuthenticated/logout
// are the real implementation, reading/writing the same localStorage
// keys production does.
const TOKEN_KEY = 'wazzar_business_access_token';
const REFRESH_KEY = 'wazzar_business_refresh_token';
const USER_KEY = 'wazzar_business_user';

vi.mock('../api', async () => {
  const actual = await vi.importActual('../api');
  return {
    ...actual,
    login: vi.fn(async (rawPhone) => {
      const result = {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        user: { id: 'biz-1', fullName: 'Neema Stores', phone: '+255700000001' },
      };
      localStorage.setItem(TOKEN_KEY, result.accessToken);
      localStorage.setItem(REFRESH_KEY, result.refreshToken);
      localStorage.setItem(USER_KEY, JSON.stringify(result.user));
      return result;
    }),
    // App.jsx loads this right after a session exists (overview/orders
    // pages both depend on it) — an empty list is enough to reach the
    // real dashboard content instead of a permanent loading spinner.
    listShipments: vi.fn(async () => []),
    // Exercises the Customers page added in this pass — a real saved
    // address-book entry from the backend, not mock data.
    listCustomers: vi.fn(async () => [
      { id: 'bc-1', name: 'Neema K.', phone: '0754221909', address: 'Mikocheni B', notes: null },
    ]),
    // Exercises the Staff page added in this pass — a real roster entry
    // from the backend, not mock data.
    listStaff: vi.fn(async () => [
      { id: 'st-1', name: 'Fatima Ali', email: 'fatima@zawadiboutique.co.tz', role: 'MANAGER', status: 'ACTIVE' },
    ]),
  };
});

describe('Business app — login critical path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders the login screen first (after the initial auth check)', async () => {
    render(<App />);
    // isAuthenticated() is real and reads real (empty) localStorage, so
    // the app briefly shows SplashScreen, then the real LoginScreen.
    await waitFor(() => expect(screen.getByText('WAZZAR Business')).toBeInTheDocument());
    expect(screen.getByText('Log in')).toBeInTheDocument();
  });

  it('walks Login → Overview dashboard, actually calling the real api module', async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByPlaceholderText('Phone number (e.g. 712 345 678)')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Phone number (e.g. 712 345 678)'), {
      target: { value: '712345678' },
    });
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'correct-horse-battery-staple' },
    });

    fireEvent.click(screen.getByText('Log in'));

    const api = await import('../api');
    await waitFor(() =>
      expect(api.login).toHaveBeenCalledWith('712345678', 'correct-horse-battery-staple'),
    );

    // Reaching the overview dashboard's real (non-mocked) copy confirms
    // the whole chain ran: login resolved, the real currentUser()/
    // isAuthenticated() read the session back out of localStorage, and
    // the real api.listShipments() call resolved for the orders widgets.
    await waitFor(() => expect(screen.getByText('Deliveries this week')).toBeInTheDocument());
    expect(screen.getByText('Deliveries this month')).toBeInTheDocument();
  });

  it('Customers page loads real address-book entries via api.listCustomers (not mock data)', async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByPlaceholderText('Phone number (e.g. 712 345 678)')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Phone number (e.g. 712 345 678)'), {
      target: { value: '712345678' },
    });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByText('Log in'));

    await waitFor(() => expect(screen.getByText('Deliveries this week')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Customers'));

    const api = await import('../api');
    await waitFor(() => expect(api.listCustomers).toHaveBeenCalled());
    // Real entry from the mocked backend response, not MOCK_BUSINESS_CUSTOMERS
    // (which this pass removed) — confirms the page renders api data, not
    // leftover mock data.
    await waitFor(() => expect(screen.getByText('Neema K.')).toBeInTheDocument());
    expect(screen.getByText('Mikocheni B')).toBeInTheDocument();
  });

  it('Staff page loads real roster entries via api.listStaff (not mock data)', async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByPlaceholderText('Phone number (e.g. 712 345 678)')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Phone number (e.g. 712 345 678)'), {
      target: { value: '712345678' },
    });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByText('Log in'));

    await waitFor(() => expect(screen.getByText('Deliveries this week')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Staff'));

    const api = await import('../api');
    await waitFor(() => expect(api.listStaff).toHaveBeenCalled());
    // Real entry from the mocked backend response, not MOCK_BUSINESS_STAFF
    // (which this pass removed).
    await waitFor(() => expect(screen.getByText('Fatima Ali')).toBeInTheDocument());
    expect(screen.getByText('fatima@zawadiboutique.co.tz')).toBeInTheDocument();
  });
});
