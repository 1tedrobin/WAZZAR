// @ts-check
/**
 * One shipment, end to end, through real rendered UI in two apps talking
 * to one real backend — customer places an order, rider (freshly
 * registered + admin-verified) accepts it, delivers it, customer sees it
 * complete.
 *
 * This is NOT a replacement for a human actually looking at the apps.
 * It proves the *wiring* works — screens transition, the right API calls
 * fire, state propagates between two independent apps through the
 * backend. It does not tell you whether any of it looks or feels right;
 * that's still a "sit down and use it" judgment call.
 *
 * Known fragility, on purpose documented rather than hidden:
 *  - Neither app has data-testid attributes anywhere, so every selector
 *    here is real button/placeholder text pulled from the current
 *    source. Any copy change breaks a selector, not just cosmetically —
 *    that's the trade-off of testing UI that was never built to be
 *    tested. Adding data-testid to the handful of screens this touches
 *    would make this far more durable; flagging that as a follow-up
 *    rather than doing it silently.
 *  - The 4-digit OTP screens in both apps are UI-only right now — the
 *    backend doesn't validate the code, it just uses the phone number's
 *    device-derived password under the hood (see api.js
 *    loginOrRegister). This test uses each screen's own "auto-fill" link
 *    rather than typing digits, since the specific digits don't matter.
 *  - Rider onboarding requires an admin to flip the rider from
 *    ONBOARDING to ACTIVE (PATCH /riders/:id/verify, admin-only). Driving
 *    the admin app's UI for that one flip felt like more surface than
 *    this test needed, so it calls that endpoint directly via the API
 *    request context, using the same seeded admin credentials the smoke
 *    test creates. The admin app's own UI is not covered by this test.
 *  - apps/business is not touched here — nothing in the core
 *    request -> accept -> deliver loop runs through it.
 */
const { test, expect } = require('@playwright/test');

const CUSTOMER_URL = process.env.CUSTOMER_URL || 'http://localhost:5173';
const RIDER_URL = process.env.RIDER_URL || 'http://localhost:5174';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE || '+255700000001';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'SmokeTest#2026';

// Random 9-digit local numbers so re-runs don't collide with a previous
// run's accounts (backend auto-registers on first login, per
// loginOrRegister in each app's api.js).
const randomLocalPhone = () =>
  String(Math.floor(700000000 + Math.random() * 99999999));

test.describe.configure({ mode: 'serial' });

test('one shipment, placed by a customer, delivered by a fresh rider', async ({
  browser,
  request,
}) => {
  const customerPhone = randomLocalPhone();
  const riderPhone = randomLocalPhone();

  const customerCtx = await browser.newContext();
  const riderCtx = await browser.newContext();
  const customer = await customerCtx.newPage();
  const rider = await riderCtx.newPage();

  // ---- Customer: onboard --------------------------------------------
  await test.step('customer signs in (auto-registers on first login)', async () => {
    await customer.goto(CUSTOMER_URL);
    await customer.getByRole('button', { name: 'Get started' }).click();
    await customer.getByPlaceholder('712 345 678').fill(customerPhone);
    await customer.getByRole('button', { name: 'Continue' }).click();
    await customer.getByText("Didn't get it? Resend code").click();
    await customer.getByRole('button', { name: /Verify/ }).click();
    // Home screen — the send-parcel entry point confirms we're through.
    await expect(
      customer.getByText('Where should we pick up?'),
    ).toBeVisible({ timeout: 15_000 });
  });

  // ---- Rider: register + get admin-verified --------------------------
  await test.step('rider registers (lands in ONBOARDING)', async () => {
    await rider.goto(RIDER_URL);
    await rider.getByRole('button', { name: 'Get started' }).click();
    await rider.getByPlaceholder('712 345 678').fill(riderPhone);
    await rider.getByRole('button', { name: 'Continue' }).click();
    await rider.getByText("Didn't get it? Resend code").click();
    await rider.getByRole('button', { name: /Verify/ }).click();

    // Identity step — idNumber/licenseNumber come prefilled; just upload
    // the two documents and continue.
    await rider.getByText('Upload national ID photo').click();
    await rider.getByText('Upload licence photo').click();
    await rider.getByRole('button', { name: 'Continue' }).click();

    // Vehicle step — plate/makeModel prefilled too.
    await rider.getByText('Upload registration document').click();
    await rider.getByText('Upload insurance certificate').click();
    await rider.getByRole('button', { name: 'Continue' }).click();

    // Profile step — needs a photo, emergency contact, and agreement.
    await rider.getByText('Profile photo').click();
    await rider.getByPlaceholder('Contact name').fill('Test Contact');
    await rider.getByPlaceholder('Contact phone').fill('+255700000099');
    await rider.getByText("I've read and agree to the terms").click();
    await rider.getByRole('button', { name: 'Submit for review' }).click();

    await expect(
      rider.getByText('Your documents are under review'),
    ).toBeVisible();
  });

  let riderAccessToken;
  await test.step('admin verifies the rider via the API', async () => {
    const loginRes = await request.post(`${BACKEND_URL}/auth/login`, {
      data: { phone: ADMIN_PHONE, password: ADMIN_PASSWORD },
    });
    expect(
      loginRes.ok(),
      `admin login failed — check SEED_ADMIN_PHONE/PASSWORD match what smoke-test.sh seeded: ${await loginRes.text()}`,
    ).toBeTruthy();
    const { accessToken: adminToken } = await loginRes.json();

    // The rider app polls GET /riders/me every 4s while pending, so we
    // just need the rider's own token to look up their profile id.
    const riderLoginRes = await request.post(`${BACKEND_URL}/auth/login`, {
      data: { phone: `+255${riderPhone}`, password: `wazzar-device-${riderPhone}` },
    });
    // If the device-password scheme in api.js ever changes, this call is
    // the first thing that'll need updating — see devicePasswordFor()
    // in apps/rider/src/api.js.
    let riderId;
    if (riderLoginRes.ok()) {
      const { accessToken } = await riderLoginRes.json();
      riderAccessToken = accessToken;
      const meRes = await request.get(`${BACKEND_URL}/riders/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const me = await meRes.json();
      riderId = me.id;
    }

    if (!riderId) {
      // Fall back to the admin-visible rider list if the device-password
      // guess above doesn't match — keeps this test from being fully
      // blocked by that one internal implementation detail.
      const listRes = await request.get(`${BACKEND_URL}/riders`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (listRes.ok()) {
        const riders = await listRes.json();
        const match = (Array.isArray(riders) ? riders : riders.data || []).find(
          (r) => r.user?.phone?.endsWith(riderPhone),
        );
        riderId = match?.id;
      }
    }

    expect(riderId, 'could not resolve the new rider\'s profile id to verify').toBeTruthy();

    const verifyRes = await request.patch(
      `${BACKEND_URL}/riders/${riderId}/verify`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    expect(verifyRes.ok(), await verifyRes.text()).toBeTruthy();
  });

  await test.step('rider is approved and goes online', async () => {
    // The go-online control is a big round button whose label is split
    // across two <span>s ("GO" / "ONLINE") with no space between them in
    // the DOM, so match on the button's role + a substring rather than
    // exact text.
    const goOnline = rider.getByRole('button', { name: /ONLINE/ });
    await expect(goOnline).toBeVisible({ timeout: 20_000 });
    await goOnline.click();
  });

  // ---- Customer: place the shipment -----------------------------------
  await test.step('customer books a delivery', async () => {
    await customer.getByText('Where should we pick up?').click();
    await customer.getByText('Mlimani City Mall, Ubungo').click();
    await customer.getByRole('button', { name: 'Confirm pickup' }).click();
    await customer.getByText('Mikocheni B, Selander Bridge').click();
    await customer.getByRole('button', { name: 'Confirm drop-off' }).click();

    await customer.getByPlaceholder('Recipient name').fill('Test Recipient');
    await customer.getByPlaceholder('Recipient phone').fill('+255700000098');
    await customer.getByRole('button', { name: 'Get price' }).click();

    // Cash avoids needing the mocked M-Pesa/Stripe webhook shim.
    await customer.getByText('Cash', { exact: true }).click();
    await expect(
      customer.getByRole('button', { name: /Confirm delivery/ }),
    ).toBeEnabled({ timeout: 15_000 }); // waits out the /pricing/calculate quote
    await customer.getByRole('button', { name: /Confirm delivery/ }).click();

    // Confirms the order actually posted and the screen advanced —
    // "Finding your rider…" only shows once POST /shipments succeeded.
    await expect(customer.getByText('Finding your rider…')).toBeVisible({
      timeout: 15_000,
    });
  });

  // ---- Rider: accept and deliver ---------------------------------------
  await test.step('rider accepts the request', async () => {
    await expect(rider.getByText('NEW DELIVERY REQUEST')).toBeVisible({
      timeout: 30_000, // rider-app polling interval + dispatch
    });
    await rider.getByRole('button', { name: 'Accept' }).click();
  });

  // Closes a real gap: VERIFICATION_PLAN.md Checkpoint 4 Test Case 3
  // explicitly calls for confirming the tracking screen shows the real
  // rider's name (not the old hardcoded "Juma Mwakalinga" mock), but
  // nothing before this asserted it — the walkthrough drove the flow
  // without ever checking what GET /riders/:id/public actually put on
  // screen. The rider app's own self-registration always uses the
  // literal fullName "WAZZAR Rider" (see apps/rider/src/api.js), so
  // that's the exact string GET /riders/:id/public should return and
  // TrackingScreen should render — not "Rider" (the no-data fallback)
  // and not the removed mock's name.
  await test.step('customer tracking screen shows the real rider, not a mock', async () => {
    await expect(customer.getByText('WAZZAR Rider')).toBeVisible({
      timeout: 15_000,
    });
    await expect(customer.getByText('Juma Mwakalinga')).toHaveCount(0);
  });

  await test.step('rider navigates to pickup and verifies the parcel', async () => {
    await rider.getByRole('button', { name: "I've arrived at pickup" }).click();
    await rider.getByText('Package matches the description').click();
    await rider.getByText('Pickup details confirmed').click();
    await rider.getByText('Auto-fill').click();
    await rider.getByRole('button', { name: 'Confirm pickup' }).click();
  });

  await test.step('rider navigates to drop-off and completes delivery', async () => {
    await rider
      .getByRole('button', { name: "I've arrived at destination" })
      .click();
    await rider.getByText('Tap to take photo').click();
    await rider.getByPlaceholder("Recipient's name").fill('Test Recipient');
    await rider.getByRole('button', { name: 'Complete delivery' }).click();
    await expect(rider.getByText('Delivery complete!')).toBeVisible({
      timeout: 15_000,
    });
  });

  // ---- Customer: sees it through -----------------------------------
  await test.step('customer sees the delivery complete', async () => {
    await expect(customer.getByText('Delivered!')).toBeVisible({
      timeout: 30_000, // customer app polls status every few seconds
    });
  });

  await customerCtx.close();
  await riderCtx.close();
});
