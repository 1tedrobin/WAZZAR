import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

// The bug this test suite exists to catch: apps/customer/src/App.jsx
// once called api.loginOrRegister/api.createShipment/etc. throughout
// the file without ever importing api.js — a ReferenceError at
// runtime that `vite build` cannot catch (see
// docs/delivery-notes/TEST_RUN_AND_NEXT_STEPS.md). A render+interaction
// test exercises the actual call, not just whether the bundle compiles.
vi.mock('../api', () => ({
  loginOrRegister: vi.fn(async () => ({
    accessToken: 'test-token',
    refreshToken: 'test-refresh',
    user: { id: 'user-1', fullName: 'Asha Juma', phone: '+255712345678' },
  })),
  calculatePrice: vi.fn(async () => ({
    price: '5000.00',
    commission: '1000.00',
    riderPayout: '4000.00',
  })),
  createShipment: vi.fn(async () => ({ id: 'shipment-1', status: 'QUOTED' })),
  initiatePayment: vi.fn(async () => ({ id: 'payment-1', status: 'PENDING' })),
  simulateProviderConfirmation: vi.fn(async () => ({ status: 'COMPLETED' })),
  requestDispatch: vi.fn(async () => ({ status: 'ASSIGNMENT_PENDING' })),
  getShipment: vi.fn(async () => ({ id: 'shipment-1', status: 'ASSIGNMENT_PENDING' })),
  completeShipment: vi.fn(async () => ({ status: 'COMPLETED' })),
}));

describe('Customer app — login critical path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the splash screen first', () => {
    render(<App />);
    expect(screen.getByText('WAZZAR')).toBeInTheDocument();
    expect(screen.getByText('Get started')).toBeInTheDocument();
  });

  it('walks Splash → Phone → OTP → Home, actually calling the real api module', async () => {
    render(<App />);

    fireEvent.click(screen.getByText('Get started'));
    expect(screen.getByText("What's your number?")).toBeInTheDocument();

    const phoneInput = screen.getByPlaceholderText('712 345 678');
    fireEvent.change(phoneInput, { target: { value: '712345678' } });
    fireEvent.click(screen.getByText('Continue'));

    expect(screen.getByText('Enter the code')).toBeInTheDocument();

    // Same "Resend code" shortcut the UI itself offers — fills a valid
    // 4-digit code without needing to simulate 4 separate keystrokes.
    fireEvent.click(screen.getByText("Didn't get it? Resend code"));

    const verifyButton = screen.getByText('Verify');
    expect(verifyButton).not.toBeDisabled();
    fireEvent.click(verifyButton);

    const api = await import('../api');
    await waitFor(() => expect(api.loginOrRegister).toHaveBeenCalledWith('712345678'));

    // A real, non-mocked App.jsx bug (missing api import, wrong prop
    // name, etc.) would leave this stuck on the OTP screen or throw —
    // reaching the home screen's pickup prompt confirms the whole
    // chain actually ran end to end.
    await waitFor(() => expect(screen.getByText('Where should we pick up?')).toBeInTheDocument());
  });
});
