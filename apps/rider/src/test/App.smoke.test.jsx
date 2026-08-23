import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

// Same rationale as the customer app's smoke test: a render+interaction
// test exercises the actual api.js call chain, which `vite build`
// alone does not (see docs/delivery-notes/TEST_RUN_AND_NEXT_STEPS.md
// for the class of bug this catches — a used-but-never-imported api
// module).
vi.mock('../api', () => ({
  loginOrRegister: vi.fn(async () => ({
    accessToken: 'test-token',
    refreshToken: 'test-refresh',
    user: { id: 'user-1', fullName: 'Juma Rider', phone: '+255712345678' },
  })),
  // ACTIVE rider — the "already onboarded and verified" branch, so the
  // test reaches Home directly rather than the registration flow.
  getMyRiderProfile: vi.fn(async () => ({
    id: 'rider-1',
    status: 'ACTIVE',
    vehicleType: 'Motorcycle',
    vehicleRegistration: 'T 482 ABC',
    ratingAvg: '4.9',
  })),
  getEarnings: vi.fn(async () => ({ totalEarnings: '0.00', deliveries: [] })),
  goOnline: vi.fn(async () => ({ isOnline: true })),
  goOffline: vi.fn(async () => ({ isOnline: false })),
  getAvailableShipments: vi.fn(async () => []),
  updateLocation: vi.fn(async () => ({})),
  ApiError: class ApiError extends Error {},
}));

describe('Rider app — login critical path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the rider-specific splash screen first', () => {
    render(<App />);
    expect(screen.getByText('WAZZAR')).toBeInTheDocument();
    expect(screen.getByText('For Riders')).toBeInTheDocument();
  });

  it('walks Splash → Phone → OTP → Home for an already-ACTIVE rider', async () => {
    render(<App />);

    fireEvent.click(screen.getByText('Get started'));
    fireEvent.change(screen.getByPlaceholderText('712 345 678'), { target: { value: '712345678' } });
    fireEvent.click(screen.getByText('Continue'));

    expect(screen.getByText('Enter the code')).toBeInTheDocument();
    fireEvent.click(screen.getByText("Didn't get it? Resend code"));
    fireEvent.click(screen.getByText('Verify'));

    const api = await import('../api');
    await waitFor(() => expect(api.loginOrRegister).toHaveBeenCalledWith('712345678'));
    await waitFor(() => expect(api.getMyRiderProfile).toHaveBeenCalled());

    // Reaching the home greeting confirms the ACTIVE-rider branch
    // (skip registration, skip pending review) actually resolved.
    await waitFor(() => expect(screen.getByText('Habari,')).toBeInTheDocument());
    expect(screen.getByText('Juma')).toBeInTheDocument();
  });
});
