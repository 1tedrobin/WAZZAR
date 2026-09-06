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
    basePrice: '2000.00',
    distanceCharge: '2500.00',
    weightCharge: '500.00',
    surgeAmount: '0.00',
    price: '5000.00',
    commission: '1000.00',
    riderPayout: '4000.00',
  })),
  createShipment: vi.fn(async () => ({ id: 'shipment-1', status: 'QUOTED' })),
  // Phase 2 — the intercity booking flow. listHubs backs
  // IntercityHubsScreen's two hub pickers; planIntercityShipment is
  // what handleConfirmOrder calls instead of createShipment when the
  // "Sending between cities" toggle is on.
  listHubs: vi.fn(async () => ([
    { id: 'hub-dar', name: 'Dar Central Hub', city: 'Dar es Salaam', latitude: '-6.79240000', longitude: '39.20830000' },
    { id: 'hub-mwanza', name: 'Mwanza Hub', city: 'Mwanza', latitude: '-2.51640000', longitude: '32.90000000' },
  ])),
  planIntercityShipment: vi.fn(async () => ({
    shipment: { id: 'shipment-2', status: 'QUOTED', shipmentType: 'INTERCITY' },
    legs: [],
  })),
  initiatePayment: vi.fn(async () => ({ id: 'payment-1', status: 'PENDING' })),
  simulateProviderConfirmation: vi.fn(async () => ({ status: 'COMPLETED' })),
  requestDispatch: vi.fn(async () => ({ status: 'ASSIGNMENT_PENDING' })),
  getShipment: vi.fn(async () => ({ id: 'shipment-1', status: 'ASSIGNMENT_PENDING' })),
  completeShipment: vi.fn(async () => ({ status: 'COMPLETED' })),
  // Fires once the flow reaches the matching/tracking screens (a real
  // outcome now that the intercity test below drives all the way
  // through confirmation) — returns a no-op unsubscribe, same shape as
  // the real WebSocket subscription's cleanup function.
  subscribeToShipmentTracking: vi.fn(() => () => {}),
  getRiderPublicProfile: vi.fn(async () => null),
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

describe('Customer app — Phase 2 intercity booking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Walks the whole between-cities path for real: logs in, confirms
  // pickup/dropoff (both prefilled with a default address, so no typing
  // needed to enable "Confirm"), flips the intercity toggle on
  // PackageScreen, picks a different hub for each end on the new
  // IntercityHubsScreen, and confirms the order — asserting
  // api.planIntercityShipment (not api.createShipment) is what actually
  // gets called, with the two hub ids the test picked.
  it('books an intercity shipment via planIntercityShipment with the chosen hubs', async () => {
    const api = await import('../api');
    render(<App />);

    fireEvent.click(screen.getByText('Get started'));
    fireEvent.change(screen.getByPlaceholderText('712 345 678'), { target: { value: '712345678' } });
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText("Didn't get it? Resend code"));
    fireEvent.click(screen.getByText('Verify'));
    await waitFor(() => expect(screen.getByText('Where should we pick up?')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Where should we pick up?'));
    fireEvent.change(screen.getByPlaceholderText('Search street, landmark...'), { target: { value: 'Mlimani City Mall, Dar es Salaam' } });
    await waitFor(() => expect(screen.getByText('Confirm pickup')).not.toBeDisabled());
    fireEvent.click(screen.getByText('Confirm pickup'));

    fireEvent.change(screen.getByPlaceholderText("Recipient's address"), { target: { value: 'Mikocheni B, Dar es Salaam' } });
    await waitFor(() => expect(screen.getByText('Confirm drop-off')).not.toBeDisabled());
    fireEvent.click(screen.getByText('Confirm drop-off'));

    await waitFor(() => expect(screen.getByText('Sending between cities')).toBeInTheDocument());
    const intercityToggle = screen.getByText('Sending between cities').parentElement.nextElementSibling;
    fireEvent.click(intercityToggle);

    const chooseHubsButton = screen.getByText('Choose hubs');
    expect(chooseHubsButton).not.toBeDisabled();
    fireEvent.click(chooseHubsButton);

    await waitFor(() => expect(api.listHubs).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText('Dar Central Hub').length).toBeGreaterThan(0));

    // Both hub lists render every hub — pick "Dar Central Hub" from the
    // first (pickup) list and "Mwanza Hub" from the second (drop-off)
    // list, matching PICKUP HUB rendering before DROP-OFF HUB in the DOM.
    fireEvent.click(screen.getAllByText('Dar Central Hub')[0]);
    fireEvent.click(screen.getAllByText('Mwanza Hub')[1]);

    const getPriceButton = screen.getByText('Get price');
    await waitFor(() => expect(getPriceButton).not.toBeDisabled());
    fireEvent.click(getPriceButton);

    await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
    const confirmButton = await screen.findByText(/Confirm delivery/);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(api.planIntercityShipment).toHaveBeenCalledWith(
      expect.objectContaining({ originHubId: 'hub-dar', destinationHubId: 'hub-mwanza' }),
    ));
    expect(api.createShipment).not.toHaveBeenCalled();
  });
});
