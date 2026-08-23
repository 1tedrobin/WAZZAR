# WAZZAR — APP REFACTORING GUIDE

> **⚠ STATUS NOTE (added 2026-08-20):** This document is pre-build planning/specification, written before the backend or any frontend wiring existed. It describes *design intent*, not current implementation status. For what's actually built today, see `backend/README.md` (piece-by-piece build log) and `docs/delivery-notes/` — those are kept current; this document is not. Some specifics here (endpoint shapes, module names, phase scoping) may no longer match the real backend. Treat this as a reference for original/Phase 2 direction, not a checklist of what exists.
>
> **Checked (2026-08-22):** This guide recommends a target stack (Zustand, react-query) for refactoring the monolithic App.jsx files — it's a prescriptive "refactor to this" guide, not a claim that the apps already use it. Checked `apps/customer/package.json`: it currently has none of these (just react, react-dom, lucide-react), which matches this guide's own premise that the refactor hasn't happened yet. No correction needed.

**Date:** August 19, 2026  
**Purpose:** Step-by-step guide to refactor monolithic apps into production-grade modular architecture  
**Target:** Customer App (1,324 lines) as primary example; same pattern for Rider, Admin, Business

---

## EXECUTIVE SUMMARY

The existing WAZZAR Customer App is a **monolithic React component** (1,324 lines in single App.jsx). This guide shows exactly how to break it into:

- ✅ 25+ reusable components
- ✅ 5 custom hooks
- ✅ 1 Zustand store
- ✅ Type-safe interfaces
- ✅ Production-ready structure

**Result:** Same UI/UX, but modular, testable, maintainable code ready for backend integration.

---

## STEP 1: UNDERSTAND CURRENT MONOLITH

### Current Customer App Structure

```
customer-app/src/App.jsx (1,324 lines)
│
├── useState declarations (50 lines)
│   ├── orders, selectedOrder, shipmentStatus
│   ├── pickupLocation, dropoffLocation
│   ├── currentRider, selectedPaymentMethod
│   └── ... + 40 more state variables
│
├── useEffect hooks (30 lines)
│   ├── Simulates order status progression
│   ├── Simulates rider location updates
│   └── Simulates payment processing
│
├── JSX rendering (1,244 lines)
│   ├── Navigation tabs (Home, History, Profile)
│   ├── Page content (varies by tab)
│   │   ├── Home page (order creation)
│   │   ├── History page (past orders)
│   │   ├── Tracking page (live map)
│   │   └── Profile page (user settings)
│   └── Modals (order details, rating, payment)
│
└── Helper functions (20 lines)
    ├── haversineKm()
    ├── pointAlongRoute()
    └── formatters
```

**Problem:** Everything is mixed together. Hard to:
- Test individual pieces
- Reuse components
- Change one thing without breaking others
- Onboard new developers
- Add new features

---

## STEP 2: DESIGN TARGET ARCHITECTURE

### Target Customer App Structure

```
apps/web/customer-app/
│
├── src/
│   │
│   ├── App.tsx                    # Root component (50 lines)
│   │   └── Handles routing, provides context
│   │
│   ├── pages/                     # Page-level components
│   │   ├── HomePage.tsx           # Home/dashboard
│   │   ├── CreateShipmentPage.tsx # New shipment flow
│   │   ├── TrackingPage.tsx       # Live tracking
│   │   ├── HistoryPage.tsx        # Past orders
│   │   └── ProfilePage.tsx        # User profile
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.tsx         # Top bar, branding
│   │   │   ├── Navigation.tsx     # Bottom tab bar
│   │   │   └── Shell.tsx          # Wrapper for layout
│   │   │
│   │   ├── shipment/
│   │   │   ├── CreateShipmentForm.tsx     # Form to create order
│   │   │   ├── ShipmentCard.tsx           # Display single order summary
│   │   │   ├── ShipmentHistory.tsx        # List of past orders
│   │   │   └── ShipmentDetails.tsx        # Full order details modal
│   │   │
│   │   ├── tracking/
│   │   │   ├── TrackingMap.tsx            # Interactive map
│   │   │   ├── RiderCard.tsx              # Rider info panel
│   │   │   ├── StatusTimeline.tsx         # Order status progression
│   │   │   └── ETADisplay.tsx             # ETA countdown
│   │   │
│   │   ├── payment/
│   │   │   ├── PaymentMethodSelector.tsx  # Choose payment
│   │   │   ├── PaymentModal.tsx           # Payment flow
│   │   │   └── PaymentStatus.tsx          # Confirmation
│   │   │
│   │   ├── rating/
│   │   │   ├── RatingModal.tsx            # Rate order
│   │   │   └── RatingStars.tsx            # 5-star selector
│   │   │
│   │   ├── profile/
│   │   │   ├── ProfileForm.tsx            # Edit profile
│   │   │   ├── PaymentMethods.tsx         # Saved payment methods
│   │   │   └── SavedAddresses.tsx         # Saved locations
│   │   │
│   │   ├── common/
│   │   │   ├── Button.tsx                 # Reusable button
│   │   │   ├── Modal.tsx                  # Modal wrapper
│   │   │   ├── Card.tsx                   # Card container
│   │   │   ├── LoadingSpinner.tsx         # Loading indicator
│   │   │   ├── ErrorMessage.tsx           # Error display
│   │   │   ├── ConfirmDialog.tsx          # Yes/no confirmation
│   │   │   └── EmptyState.tsx             # Empty state display
│   │   │
│   │   └── icons/
│   │       └── [Lucide icons imported]
│   │
│   ├── hooks/                     # Custom React hooks
│   │   ├── useShipments.ts        # shipment CRUD operations
│   │   ├── useTracking.ts         # Real-time tracking subscription
│   │   ├── useAuth.ts             # Authentication state
│   │   ├── useLocation.ts         # Geolocation
│   │   ├── usePayment.ts          # Payment processing
│   │   └── useLocalStorage.ts     # Persistent state
│   │
│   ├── services/                  # API communication
│   │   ├── api-client.ts          # Axios instance with interceptors
│   │   ├── shipments-api.ts       # Shipment endpoints
│   │   ├── auth-api.ts            # Auth endpoints
│   │   ├── payment-api.ts         # Payment endpoints
│   │   └── location-api.ts        # Location endpoints
│   │
│   ├── store/                     # Zustand stores
│   │   ├── auth-store.ts          # Auth state (user, token)
│   │   ├── shipment-store.ts      # Shipment state
│   │   └── ui-store.ts            # UI state (active tab, modals)
│   │
│   ├── types/                     # TypeScript interfaces
│   │   ├── shipment.ts
│   │   ├── user.ts
│   │   ├── payment.ts
│   │   ├── rider.ts
│   │   └── api.ts
│   │
│   ├── utils/                     # Utility functions
│   │   ├── distance.ts            # Haversine, routing
│   │   ├── formatting.ts          # Format money, dates, etc.
│   │   ├── validation.ts          # Input validation
│   │   └── constants.ts           # Colors, categories
│   │
│   ├── styles/
│   │   └── globals.css            # Global styles, Tailwind overrides
│   │
│   ├── App.tsx                    # Root app component
│   ├── main.tsx                   # Entry point
│   └── index.css
│
├── public/
├── vite.config.ts
├── tailwind.config.ts
├── package.json
└── tsconfig.json
```

**Benefits:**
- ✅ Clear separation of concerns
- ✅ Reusable components
- ✅ Easy to test
- ✅ Easy to find code
- ✅ Easy to add features
- ✅ Type-safe (TypeScript)

---

## STEP 3: EXTRACT COMPONENTS

### 3.1 Create Layout Components

**Header.tsx** (50 lines)

```typescript
import React from 'react'
import { ChevronLeft } from 'lucide-react'

interface HeaderProps {
  title: string
  showBack?: boolean
  onBackClick?: () => void
}

export function Header({ title, showBack, onBackClick }: HeaderProps) {
  return (
    <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
      {showBack && (
        <button onClick={onBackClick} className="hover:bg-gray-100 p-2 rounded">
          <ChevronLeft size={24} />
        </button>
      )}
      <h1 className="text-xl font-bold text-gray-900">{title}</h1>
    </div>
  )
}
```

**Navigation.tsx** (80 lines)

```typescript
import React from 'react'
import { Home, History, User } from 'lucide-react'

interface NavigationProps {
  activeTab: 'home' | 'history' | 'profile'
  onTabChange: (tab: 'home' | 'history' | 'profile') => void
}

export function Navigation({ activeTab, onTabChange }: NavigationProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex justify-around py-3">
      <NavButton
        icon={Home}
        label="Home"
        active={activeTab === 'home'}
        onClick={() => onTabChange('home')}
      />
      <NavButton
        icon={History}
        label="History"
        active={activeTab === 'history'}
        onClick={() => onTabChange('history')}
      />
      <NavButton
        icon={User}
        label="Profile"
        active={activeTab === 'profile'}
        onClick={() => onTabChange('profile')}
      />
    </div>
  )
}

function NavButton({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 p-2 ${active ? 'text-blue-600' : 'text-gray-600'}`}
    >
      <Icon size={24} />
      <span className="text-xs">{label}</span>
    </button>
  )
}
```

**Shell.tsx** (100 lines)

```typescript
import React from 'react'
import { Header } from './Header'
import { Navigation } from './Navigation'

interface ShellProps {
  children: React.ReactNode
  currentPage: 'home' | 'history' | 'profile' | 'tracking'
  onPageChange: (page: string) => void
  headerTitle: string
  showHeader?: boolean
}

export function Shell({
  children,
  currentPage,
  onPageChange,
  headerTitle,
  showHeader = true
}: ShellProps) {
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {showHeader && <Header title={headerTitle} />}
      
      <main className="flex-1 overflow-y-auto pb-20">
        {children}
      </main>
      
      {currentPage !== 'tracking' && (
        <Navigation
          activeTab={currentPage as any}
          onTabChange={onPageChange as any}
        />
      )}
    </div>
  )
}
```

---

### 3.2 Create Shipment Components

**CreateShipmentForm.tsx** (200 lines)

```typescript
import React, { useState } from 'react'
import { MapPin, Package, DollarSign } from 'lucide-react'
import { useShipments } from '../hooks/useShipments'
import { Button } from './common/Button'
import { ErrorMessage } from './common/ErrorMessage'

interface CreateShipmentFormProps {
  onSuccess?: (shipmentId: string) => void
}

export function CreateShipmentForm({ onSuccess }: CreateShipmentFormProps) {
  const { createShipment, isLoading, error } = useShipments()
  
  const [pickupAddress, setPickupAddress] = useState('')
  const [dropoffAddress, setDropoffAddress] = useState('')
  const [category, setCategory] = useState('docs')
  const [weight, setWeight] = useState(0.5)
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      const shipment = await createShipment({
        pickupAddress,
        dropoffAddress,
        category,
        weightKg: weight
      })
      
      onSuccess?.(shipment.id)
    } catch (err) {
      console.error('Failed to create shipment:', err)
    }
  }
  
  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      {error && <ErrorMessage message={error.message} />}
      
      <div>
        <label className="block text-sm font-medium text-gray-700">
          <MapPin size={16} className="inline mr-2" />
          Pickup Address
        </label>
        <input
          type="text"
          value={pickupAddress}
          onChange={(e) => setPickupAddress(e.target.value)}
          placeholder="Enter pickup location"
          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
          required
        />
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700">
          <MapPin size={16} className="inline mr-2" />
          Dropoff Address
        </label>
        <input
          type="text"
          value={dropoffAddress}
          onChange={(e) => setDropoffAddress(e.target.value)}
          placeholder="Enter dropoff location"
          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
          required
        />
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700">
          <Package size={16} className="inline mr-2" />
          Category
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
        >
          <option value="docs">Documents</option>
          <option value="parcel">Parcel</option>
          <option value="food">Food</option>
          <option value="medicine">Medicine</option>
        </select>
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Weight (kg)
        </label>
        <input
          type="number"
          value={weight}
          onChange={(e) => setWeight(parseFloat(e.target.value))}
          step="0.1"
          min="0"
          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
        />
      </div>
      
      <Button
        type="submit"
        disabled={isLoading}
        className="w-full"
      >
        {isLoading ? 'Creating...' : 'Create Shipment'}
      </Button>
    </form>
  )
}
```

**ShipmentCard.tsx** (80 lines)

```typescript
import React from 'react'
import { MapPin, Clock, Star, Bike } from 'lucide-react'
import { Shipment } from '../types/shipment'

interface ShipmentCardProps {
  shipment: Shipment
  onClick?: () => void
}

export function ShipmentCard({ shipment, onClick }: ShipmentCardProps) {
  const statusColors = {
    CREATED: 'bg-gray-100 text-gray-800',
    CONFIRMED: 'bg-blue-100 text-blue-800',
    ASSIGNED: 'bg-blue-100 text-blue-800',
    IN_TRANSIT: 'bg-yellow-100 text-yellow-800',
    DELIVERED: 'bg-green-100 text-green-800',
  }
  
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-lg p-4 border border-gray-200 cursor-pointer hover:shadow-md transition"
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="font-semibold text-gray-900">{shipment.id}</h3>
          <p className="text-sm text-gray-500">{new Date(shipment.createdAt).toLocaleDateString()}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[shipment.status]}`}>
          {shipment.status}
        </span>
      </div>
      
      <div className="space-y-2 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <MapPin size={16} />
          <span>{shipment.pickupAddress}</span>
        </div>
        <div className="flex items-center gap-2">
          <MapPin size={16} />
          <span>{shipment.dropoffAddress}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-medium text-gray-900">TZS {shipment.price.toLocaleString()}</span>
          {shipment.rider && (
            <div className="flex items-center gap-1">
              <Bike size={16} />
              <span>{shipment.rider.name}</span>
              <span className="text-yellow-500">★ {shipment.rider.rating}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

---

### 3.3 Create Common Components

**Button.tsx** (40 lines)

```typescript
import React from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  const baseStyles = 'font-medium rounded-md transition'
  
  const variantStyles = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 disabled:bg-gray-400',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-400',
  }
  
  const sizeStyles = {
    sm: 'px-3 py-1 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  }
  
  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className || ''}`}
      {...props}
    >
      {children}
    </button>
  )
}
```

**Modal.tsx** (60 lines)

```typescript
import React from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  if (!isOpen) return null
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end z-50">
      <div className="bg-white w-full rounded-t-lg p-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} className="hover:bg-gray-100 p-2 rounded">
            <X size={24} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
```

**LoadingSpinner.tsx** (30 lines)

```typescript
import React from 'react'

export function LoadingSpinner() {
  return (
    <div className="flex justify-center items-center py-8">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
    </div>
  )
}
```

---

### 3.4 Create Page Components

**HomePage.tsx** (150 lines)

```typescript
import React, { useState } from 'react'
import { Shell } from '../components/layout/Shell'
import { CreateShipmentForm } from '../components/shipment/CreateShipmentForm'
import { ShipmentCard } from '../components/shipment/ShipmentCard'
import { Button } from '../components/common/Button'
import { useShipments } from '../hooks/useShipments'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { Modal } from '../components/common/Modal'

export function HomePage() {
  const { shipments, isLoading } = useShipments()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState(null)
  
  if (isLoading) return <LoadingSpinner />
  
  const recentOrders = shipments?.slice(0, 3) || []
  
  return (
    <Shell
      currentPage="home"
      onPageChange={() => {}}
      headerTitle="WAZZAR"
    >
      <div className="p-4 space-y-4">
        <Button
          className="w-full"
          onClick={() => setShowCreateModal(true)}
        >
          Create New Shipment
        </Button>
        
        <div>
          <h2 className="text-lg font-bold mb-3">Recent Orders</h2>
          <div className="space-y-3">
            {recentOrders.map(order => (
              <ShipmentCard
                key={order.id}
                shipment={order}
                onClick={() => setSelectedOrder(order)}
              />
            ))}
          </div>
        </div>
      </div>
      
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create New Shipment"
      >
        <CreateShipmentForm
          onSuccess={(shipmentId) => {
            setShowCreateModal(false)
            // Refetch orders
          }}
        />
      </Modal>
    </Shell>
  )
}
```

**TrackingPage.tsx** (180 lines)

```typescript
import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Shell } from '../components/layout/Shell'
import { TrackingMap } from '../components/tracking/TrackingMap'
import { RiderCard } from '../components/tracking/RiderCard'
import { StatusTimeline } from '../components/tracking/StatusTimeline'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { ErrorMessage } from '../components/common/ErrorMessage'
import { useTracking } from '../hooks/useTracking'

export function TrackingPage() {
  const { shipmentId } = useParams<{ shipmentId: string }>()
  const { tracking, isLoading, error } = useTracking(shipmentId!)
  
  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message={error.message} />
  if (!tracking) return <ErrorMessage message="Shipment not found" />
  
  return (
    <Shell
      currentPage="tracking"
      onPageChange={() => {}}
      headerTitle={`Order ${tracking.shipment.id}`}
      showHeader={true}
    >
      <div className="space-y-4 pb-4">
        <TrackingMap
          pickupLocation={tracking.shipment.pickupLocation}
          dropoffLocation={tracking.shipment.dropoffLocation}
          riderLocation={tracking.riderLocation}
          eta={tracking.eta}
        />
        
        {tracking.rider && (
          <RiderCard rider={tracking.rider} />
        )}
        
        <StatusTimeline
          states={tracking.states}
          currentState={tracking.shipment.status}
        />
      </div>
    </Shell>
  )
}
```

---

## STEP 4: CREATE HOOKS

### useShipments.ts

```typescript
import { useQuery, useMutation, useQueryClient } from 'react-query'
import * as shipmentsApi from '../services/shipments-api'
import { Shipment } from '../types/shipment'

export function useShipments() {
  const queryClient = useQueryClient()
  
  const { data: shipments, isLoading, error } = useQuery(
    ['shipments'],
    () => shipmentsApi.list()
  )
  
  const createMutation = useMutation(
    (data) => shipmentsApi.create(data),
    {
      onSuccess: (newShipment) => {
        queryClient.invalidateQueries(['shipments'])
        queryClient.setQueryData(['shipment', newShipment.id], newShipment)
      }
    }
  )
  
  const rateMutation = useMutation(
    ({ shipmentId, rating }: { shipmentId: string; rating: number }) =>
      shipmentsApi.rate(shipmentId, rating),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['shipments'])
      }
    }
  )
  
  return {
    shipments: shipments || [],
    isLoading,
    error,
    createShipment: (data) => createMutation.mutateAsync(data),
    rateShipment: (shipmentId, rating) =>
      rateMutation.mutateAsync({ shipmentId, rating })
  }
}
```

### useTracking.ts

```typescript
import { useEffect, useState } from 'react'
import * as trackingApi from '../services/tracking-api'

export function useTracking(shipmentId: string) {
  const [tracking, setTracking] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  
  useEffect(() => {
    let mounted = true
    
    const fetchTracking = async () => {
      try {
        const data = await trackingApi.getTracking(shipmentId)
        if (mounted) setTracking(data)
      } catch (err) {
        if (mounted) setError(err as Error)
      } finally {
        if (mounted) setIsLoading(false)
      }
    }
    
    // Initial fetch
    fetchTracking()
    
    // Subscribe to real-time updates
    const unsubscribe = trackingApi.subscribeToTracking(
      shipmentId,
      (data) => {
        if (mounted) setTracking(data)
      }
    )
    
    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [shipmentId])
  
  return { tracking, isLoading, error }
}
```

### useAuth.ts

```typescript
import { useQuery } from 'react-query'
import { useAuthStore } from '../store/auth-store'

export function useAuth() {
  const { user, token, login, logout } = useAuthStore()
  
  return {
    user,
    token,
    isAuthenticated: !!token,
    login: async (phone: string, password: string) => {
      return login(phone, password)
    },
    logout,
    isLoading: false
  }
}
```

---

## STEP 5: CREATE ZUSTAND STORES

### auth-store.ts

```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import * as authApi from '../services/auth-api'

interface User {
  id: string
  phone: string
  name: string
  email?: string
  avatar?: string
}

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  
  login: (phone: string, password: string) => Promise<void>
  logout: () => void
  setUser: (user: User) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      
      login: async (phone: string, password: string) => {
        try {
          const response = await authApi.login(phone, password)
          set({
            user: response.user,
            token: response.token,
            isAuthenticated: true
          })
        } catch (error) {
          throw error
        }
      },
      
      logout: () => {
        set({
          user: null,
          token: null,
          isAuthenticated: false
        })
      },
      
      setUser: (user: User) => {
        set({ user })
      }
    }),
    {
      name: 'auth-store'
    }
  )
)
```

---

## STEP 6: CREATE API SERVICES

### services/api-client.ts

```typescript
import axios from 'axios'
import { useAuthStore } from '../store/auth-store'

export const apiClient = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3000/api/v1',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Add token to requests
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout()
    }
    return Promise.reject(error)
  }
)

export default apiClient
```

### services/shipments-api.ts

```typescript
import apiClient from './api-client'
import { Shipment } from '../types/shipment'

export async function list(): Promise<Shipment[]> {
  const response = await apiClient.get('/shipments')
  return response.data.shipments
}

export async function get(id: string): Promise<Shipment> {
  const response = await apiClient.get(`/shipments/${id}`)
  return response.data
}

export async function create(data: any): Promise<Shipment> {
  const response = await apiClient.post('/shipments', data)
  return response.data
}

export async function rate(shipmentId: string, score: number): Promise<void> {
  await apiClient.post(`/shipments/${shipmentId}/rate`, { score })
}
```

---

## STEP 7: CREATE TYPES

### types/shipment.ts

```typescript
export type ShipmentStatus =
  | 'CREATED'
  | 'QUOTED'
  | 'CONFIRMED'
  | 'ASSIGNED'
  | 'PICKUP_IN_PROGRESS'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'

export interface Location {
  latitude: number
  longitude: number
  address: string
  instruction?: string
}

export interface Shipment {
  id: string
  customerId: string
  riderId?: string
  status: ShipmentStatus
  pickupLocation: Location
  dropoffLocation: Location
  packageDescription: string
  packageWeightKg: number
  price: number
  createdAt: string
  completedAt?: string
  rider?: Rider
}

export interface Rider {
  id: string
  name: string
  phone: string
  rating: number
  vehicle: string
  plate: string
}
```

---

## STEP 8: NEW App.tsx ROOT COMPONENT

```typescript
import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider, QueryClient } from 'react-query'
import { useAuthStore } from './store/auth-store'

import { HomePage } from './pages/HomePage'
import { CreateShipmentPage } from './pages/CreateShipmentPage'
import { TrackingPage } from './pages/TrackingPage'
import { HistoryPage } from './pages/HistoryPage'
import { ProfilePage } from './pages/ProfilePage'
import { LoginPage } from './pages/LoginPage'

const queryClient = new QueryClient()

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <HomePage />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/create"
            element={
              <ProtectedRoute>
                <CreateShipmentPage />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/track/:shipmentId"
            element={
              <ProtectedRoute>
                <TrackingPage />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/history"
            element={
              <ProtectedRoute>
                <HistoryPage />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
```

---

## STEP 9: REFACTORING CHECKLIST

### Phase 1: Component Extraction

- [ ] Create `src/components/layout/` folder and components (Header, Navigation, Shell)
- [ ] Create `src/components/shipment/` folder and components (Create, Card, List, Details)
- [ ] Create `src/components/tracking/` folder and components (Map, RiderCard, Timeline)
- [ ] Create `src/components/common/` folder and reusable components (Button, Modal, Spinner, etc.)
- [ ] Extract all inline styles to components
- [ ] Remove mock data from JSX; move to hooks/stores

**Time:** 40 hours

### Phase 2: Hooks & State

- [ ] Create `src/hooks/useShipments.ts`
- [ ] Create `src/hooks/useTracking.ts`
- [ ] Create `src/hooks/useAuth.ts`
- [ ] Create `src/hooks/useLocation.ts`
- [ ] Create `src/store/auth-store.ts` (Zustand)
- [ ] Create `src/store/shipment-store.ts` (Zustand)
- [ ] Replace all useState with hooks/stores

**Time:** 30 hours

### Phase 3: API Services

- [ ] Create `src/services/api-client.ts` (Axios)
- [ ] Create `src/services/shipments-api.ts`
- [ ] Create `src/services/auth-api.ts`
- [ ] Create `src/services/payment-api.ts`
- [ ] Create `src/services/location-api.ts`
- [ ] Add React Query integration
- [ ] Replace mock data with API calls

**Time:** 40 hours

### Phase 4: Types & Utils

- [ ] Create `src/types/shipment.ts`
- [ ] Create `src/types/user.ts`
- [ ] Create `src/types/payment.ts`
- [ ] Create `src/utils/distance.ts` (move haversineKm)
- [ ] Create `src/utils/formatting.ts`
- [ ] Create `src/utils/constants.ts`

**Time:** 10 hours

### Phase 5: Routing & Pages

- [ ] Create `src/pages/HomePage.tsx`
- [ ] Create `src/pages/CreateShipmentPage.tsx`
- [ ] Create `src/pages/TrackingPage.tsx`
- [ ] Create `src/pages/HistoryPage.tsx`
- [ ] Create `src/pages/ProfilePage.tsx`
- [ ] Create `src/pages/LoginPage.tsx`
- [ ] Setup React Router v6
- [ ] Setup route protection

**Time:** 20 hours

### Phase 6: Testing & Cleanup

- [ ] Add ESLint + Prettier config
- [ ] Add Jest/Vitest setup
- [ ] Write unit tests for components (20% coverage)
- [ ] Write hook tests
- [ ] Remove mockData.js
- [ ] Update package.json scripts

**Time:** 20 hours

---

## TOTAL REFACTORING EFFORT

| Phase | Hours |
|-------|-------|
| Component Extraction | 40 |
| Hooks & State | 30 |
| API Services | 40 |
| Types & Utils | 10 |
| Routing & Pages | 20 |
| Testing & Cleanup | 20 |
| **TOTAL** | **160 hours** |

**Timeline:** 4 weeks (1 full-time engineer) or 2 weeks (2 engineers)

---

## SAME PATTERN FOR OTHER APPS

### Rider App (1,308 lines)

**Key Components:**
- `AvailableOrders.tsx` — Map of nearby orders
- `ActiveShipment.tsx` — Current delivery
- `EarningsDashboard.tsx` — Earnings & withdrawals
- `RiderProfile.tsx` — Profile & verification

**Key Hooks:**
- `useAvailableOrders()` — Real-time order updates
- `useActiveShipment()` — Current delivery state
- `useEarnings()` — Rider earnings
- `useRiderLocation()` — GPS tracking

**Effort:** 150 hours (similar to customer app)

---

### Admin App (658 lines)

**Key Components:**
- `OrdersTable.tsx` — Order management
- `UsersTable.tsx` — User management
- `DisputesPanel.tsx` — Dispute resolution
- `AnalyticsDashboard.tsx` — Stats & charts

**Key Hooks:**
- `useOrders()` — Admin order list
- `useUsers()` — Admin user management
- `useDisputes()` — Open disputes

**Effort:** 80 hours (smaller than customer app)

---

### Business App (664 lines)

**Key Components:**
- `BulkShipmentUpload.tsx` — CSV upload
- `ShipmentList.tsx` — Shipment tracking
- `InvoiceViewer.tsx` — Monthly invoices
- `APIKeysPanel.tsx` — API key management

**Key Hooks:**
- `useBulkShipments()` — Bulk operations
- `useBusinessAnalytics()` — B2B analytics

**Effort:** 90 hours (similar size to admin)

---

## NEXT STEPS

1. **Week 1:** Refactor Customer App (40 hours)
2. **Week 2:** Refactor Rider App (40 hours)
3. **Week 3:** Refactor Admin App (20 hours)
4. **Week 4:** Refactor Business App (20 hours)

**Total: 4 weeks to modular architecture**

Then: Connect to backend (see WAZZAR_BUILD_COOKBOOK.md Section 4)

