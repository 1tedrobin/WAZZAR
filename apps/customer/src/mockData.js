/* ========================================================================
   MOCK DATA — placeholder records for local development only.

   Nothing in this file is real. It exists so the Customer app screens have
   something to render before this app is wired up to the real backend.
   Swap the geo defaults for a real reverse-geocoded location, and MOCK_RIDER/MOCK_ORDER_ID for whatever rider and order the backend actually assigns to this customer.

   In production, every export below is replaced by a call against the
   shared database (the same tables every WAZZAR surface reads and
   writes) — this file is deleted, not edited into something real.
   ======================================================================== */

export const MOCK_PICKUP_COORD = { lat: -6.7736, lng: 39.2044 };   // Mlimani City Mall, Ubungo

export const MOCK_DROPOFF_COORD = { lat: -6.7667, lng: 39.2472 };  // Mikocheni B, Selander Bridge

export const MOCK_RIDER_START_COORD = { lat: -6.779, lng: 39.198 };

export const MOCK_PICKUP_ADDRESS = "Mlimani City Mall, Ubungo";

export const MOCK_DROPOFF_ADDRESS = "Mikocheni B, Selander Bridge";

export const MOCK_PICKUP_SUGGESTIONS = ["Mlimani City Mall, Ubungo", "Kariakoo Market", "Msasani Peninsula"];

export const MOCK_DROPOFF_SUGGESTIONS = ["Mikocheni B, Selander Bridge", "Oyster Bay", "Sinza Mori"];

export const MOCK_RIDER = {
  id: "r1",
  name: "Juma Mwakalinga",
  initials: "JM",
  phone: "+255 754 221 903",
  vehicle: "Yamaha Crux",
  plate: "T 482 ABC",
  rating: 4.9,
  acceptance: 92,
  deliveries: 412,
  status: "Active",
  verification: "Approved",
};

export const MOCK_CUSTOMER = {
  name: "Asha Mrisho",
  initials: "A",
  phone: "+255 712 345 678",
  rating: 4.9,
};

export const MOCK_ORDER_ID = "#WAZZAR-2847";
