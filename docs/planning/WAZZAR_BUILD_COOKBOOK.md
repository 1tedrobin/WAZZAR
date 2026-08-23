# WAZZAR — BUILD COOKBOOK

> **⚠ STATUS NOTE (added 2026-08-20):** This document is pre-build planning/specification, written before the backend or any frontend wiring existed. It describes *design intent*, not current implementation status. For what's actually built today, see `backend/README.md` (piece-by-piece build log) and `docs/delivery-notes/` — those are kept current; this document is not. Some specifics here (endpoint shapes, module names, phase scoping) may no longer match the real backend. Treat this as a reference for original/Phase 2 direction, not a checklist of what exists.
>
> **Checked (2026-08-22):** The local-setup instructions (PostgreSQL via Docker, `wazzar_db`, credentials, port 5432) were checked against the real `backend/docker-compose.yml` and `.env.example` — they match exactly, no correction needed. The "separate service" mention in a sample git-commit message refers to extracting a NestJS service class within the monolith, not a microservices claim. The rest of this large guide (1,797 lines covering all four apps in detail) was not re-verified line-by-line against current code.

**Date:** August 18, 2026  
**Version:** 1.0  
**Status:** Production Developer Guide

**Purpose:** Step-by-step guide for developers to build, maintain, and extend WAZZAR.

---

## TABLE OF CONTENTS

1. Getting Started (Local Setup)
2. Repository Structure
3. Development Workflow
4. Backend Development (NestJS)
5. Frontend Development (React)
6. Mobile Development (React Native)
7. Database Development
8. API Development
9. Adding Features (Step-by-Step)
10. Testing Guide
11. Deployment Guide
12. Troubleshooting
13. Security Checklist
14. Performance Optimization

---

## 1. GETTING STARTED (LOCAL SETUP)

### Prerequisites

- **Node.js:** v18+ (https://nodejs.org)
- **npm/yarn:** Package manager
- **PostgreSQL:** v14+ (https://www.postgresql.org or Docker)
- **Redis:** v6+ (https://redis.io or Docker)
- **Git:** Version control
- **Docker:** Optional but recommended (Docker Desktop)
- **VSCode or similar:** IDE with TypeScript support

### Quick Start (5 minutes)

```bash
# 1. Clone repository
git clone https://github.com/wazzar/wazzar.git
cd wazzar

# 2. Copy environment template
cp .env.example .env.local

# 3. Install dependencies
npm install

# 4. Start PostgreSQL (Docker)
docker run -d \
  --name wazzar-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:15

# 5. Start Redis (Docker)
docker run -d \
  --name wazzar-redis \
  -p 6379:6379 \
  redis:7

# 6. Create database
npm run db:create

# 7. Run migrations
npm run db:migrate

# 8. Seed development data
npm run db:seed

# 9. Start backend
npm run dev

# 10. In new terminal, start frontend
cd apps/web && npm run dev

# 11. Open http://localhost:5173
```

### Environment Setup (.env.local)

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wazzar_db

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=dev-secret-key-min-32-chars-required-here
JWT_EXPIRY_SECONDS=900

# Mobile Money (Test credentials)
MPESA_CONSUMER_KEY=test_key
MPESA_CONSUMER_SECRET=test_secret
MPESA_SHORTCODE=123456

# Stripe (Test key)
STRIPE_SECRET_KEY=sk_test_...

# Maps
GOOGLE_MAPS_API_KEY=dev_key_unlimited_for_local

# SMS (Twilio test)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+15551234567

# Firebase (Push notifications test)
FIREBASE_PROJECT_ID=wazzar-dev
FIREBASE_PRIVATE_KEY="..."

# App
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
```

### Docker Compose (Alternative Quick Start)

```yaml
# docker-compose.yml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    ports:
      - "6379:6379"

  backend:
    build: ./backend
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/wazzar_db
      REDIS_URL: redis://redis:6379
    depends_on:
      - postgres
      - redis

volumes:
  postgres_data:
```

```bash
# One command to start everything
docker-compose up
```

---

## 2. REPOSITORY STRUCTURE

```
wazzar/
├── apps/
│   ├── web/                        # React web app
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   ├── hooks/
│   │   │   ├── services/           # API calls
│   │   │   ├── store/              # Zustand stores
│   │   │   ├── types/              # TS interfaces
│   │   │   └── App.tsx
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   ├── admin/                      # Admin dashboard
│   │   └── (same structure as web)
│   │
│   ├── mobile/                     # React Native (iOS + Android)
│   │   ├── src/
│   │   ├── ios/
│   │   ├── android/
│   │   └── app.json
│   │
│   ├── mobile-android/             # Native Android (Kotlin)
│   │   ├── app/src/main/
│   │   ├── build.gradle
│   │   └── settings.gradle
│   │
│   └── mobile-ios/                 # Native iOS (Swift)
│       ├── WAZZAR/
│       ├── WazzarTests/
│       └── WAZZAR.xcodeproj
│
├── backend/
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/               # Authentication
│   │   │   ├── users/
│   │   │   ├── shipments/
│   │   │   ├── matching/
│   │   │   ├── pricing/
│   │   │   ├── location/
│   │   │   ├── payments/
│   │   │   ├── notifications/
│   │   │   ├── ratings/
│   │   │   ├── admin/
│   │   │   ├── integrations/
│   │   │   └── tracking/           # Phase 2
│   │   ├── common/
│   │   │   ├── guards/
│   │   │   ├── decorators/
│   │   │   ├── interceptors/
│   │   │   ├── filters/
│   │   │   ├── pipes/
│   │   │   └── middleware/
│   │   ├── database/
│   │   │   ├── entities/
│   │   │   ├── migrations/
│   │   │   └── seeds/
│   │   ├── config/
│   │   ├── types/
│   │   └── main.ts
│   ├── test/
│   ├── .env.example
│   ├── ormconfig.ts
│   └── package.json
│
├── packages/                       # Shared code
│   ├── types/                      # Shared TypeScript types
│   ├── api-client/                 # Axios instance + API calls (shared)
│   └── utils/
│
├── database/
│   ├── migrations/                 # Version-controlled schema
│   ├── seeds/
│   └── README.md
│
├── infrastructure/
│   ├── docker/
│   ├── terraform/                  # IaC for AWS
│   ├── kubernetes/                 # K8s config (Phase 2+)
│   └── ci-cd/
│
├── docs/
│   ├── API.md
│   ├── ARCHITECTURE.md
│   ├── DATABASE.md
│   ├── CONTRIBUTING.md
│   └── TROUBLESHOOTING.md
│
├── .github/
│   └── workflows/                  # CI/CD pipelines
│
├── .gitignore
├── .prettierrc
├── .eslintrc.js
├── tsconfig.json
├── docker-compose.yml
├── README.md
└── package.json                    # Monorepo root
```

### Each App's package.json

```json
{
  "name": "@wazzar/web",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint src",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18",
    "react-router-dom": "^6",
    "zustand": "^4",
    "axios": "^1",
    "react-query": "^3",
    "tailwindcss": "^3"
  }
}
```

---

## 3. DEVELOPMENT WORKFLOW

### Daily Development Flow

```bash
# Morning: Start fresh
git pull origin main
npm install
npm run db:migrate    # If any schema changes

# Create feature branch
git checkout -b feature/rider-earnings-dashboard

# Make changes, commit frequently
git add .
git commit -m "feat: Add earnings calculation service"

# Push for review
git push origin feature/rider-earnings-dashboard

# Create PR, get review, fix comments

# After approval: merge to staging
git checkout staging
git pull
git merge feature/rider-earnings-dashboard
npm run build && npm run test

# Test in staging, then merge to main for production
```

### Git Conventions

**Branch naming:**

```
feature/short-description      # New feature
bugfix/issue-description       # Bug fix
hotfix/urgent-production-fix   # Emergency production fix
docs/documentation-update      # Documentation only
refactor/improvement-name      # Code cleanup, no behavior change
```

**Commit messages:**

```
feat: Add rider location tracking to customer map
fix: Resolve payment reconciliation off-by-one error
docs: Update API docs for v1.1
test: Add tests for matching algorithm
refactor: Extract pricing logic into separate service
chore: Upgrade dependencies
```

**Pull Request:**

```
Title: feat: Add real-time shipment tracking via WebSocket

Description:
Implements real-time tracking for shipments using WebSocket protocol.

Changes:
- Add WebSocket handler in LocationService
- Add tracking reducer in React (store)
- Add MapComponent with live rider updates
- Add E2E tests for tracking flow

Fixes: #1234
Tests: npm run test:tracking
```

---

## 4. BACKEND DEVELOPMENT (NestJS)

### Create a New Module

```bash
# Generate module skeleton
npm run g module shipments

# This creates:
# src/modules/shipments/
# ├── shipments.controller.ts
# ├── shipments.service.ts
# ├── shipments.module.ts
# └── dto/
#     ├── create-shipment.dto.ts
#     └── update-shipment.dto.ts
```

### Implement a Service

```typescript
// src/modules/shipments/shipments.service.ts
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Shipment } from '../../database/entities/shipment.entity'
import { CreateShipmentDto } from './dto/create-shipment.dto'

@Injectable()
export class ShipmentsService {
  constructor(
    @InjectRepository(Shipment)
    private shipmentsRepo: Repository<Shipment>,
    private pricingService: PricingService,
    private matchingService: MatchingService
  ) {}

  async create(customerId: string, dto: CreateShipmentDto): Promise<Shipment> {
    // Validate input
    if (!dto.pickupLocation || !dto.dropoffLocation) {
      throw new BadRequestException('Locations required')
    }

    // Calculate price
    const price = await this.pricingService.calculate({
      origin: dto.pickupLocation,
      destination: dto.dropoffLocation,
      weight: dto.package.weightKg
    })

    // Create shipment
    const shipment = this.shipmentsRepo.create({
      customerId,
      pickupLocation: dto.pickupLocation,
      dropoffLocation: dto.dropoffLocation,
      packageDescription: dto.package.description,
      packageWeightKg: dto.package.weightKg,
      price: price.total,
      status: 'CREATED'
    })

    await this.shipmentsRepo.save(shipment)

    // Emit event for other services
    this.eventEmitter.emit('shipment:created', { shipmentId: shipment.id })

    return shipment
  }

  async getById(id: string): Promise<Shipment> {
    const shipment = await this.shipmentsRepo.findOne({ where: { id } })
    if (!shipment) {
      throw new NotFoundException('Shipment not found')
    }
    return shipment
  }

  async list(
    customerId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{ data: Shipment[]; total: number }> {
    const [data, total] = await this.shipmentsRepo.findAndCount({
      where: { customerId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit
    })
    return { data, total }
  }
}
```

### Implement a Controller

```typescript
// src/modules/shipments/shipments.controller.ts
import { Controller, Post, Get, Body, Param, Query, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { GetUser } from '../../common/decorators/get-user.decorator'
import { ShipmentsService } from './shipments.service'
import { CreateShipmentDto } from './dto/create-shipment.dto'

@Controller('api/v1/shipments')
@UseGuards(AuthGuard('jwt'))
export class ShipmentsController {
  constructor(private shipmentsService: ShipmentsService) {}

  @Post()
  async create(
    @GetUser() user,
    @Body() dto: CreateShipmentDto
  ) {
    return this.shipmentsService.create(user.id, dto)
  }

  @Get()
  async list(
    @GetUser() user,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20
  ) {
    return this.shipmentsService.list(user.id, page, limit)
  }

  @Get(':id')
  async getOne(
    @GetUser() user,
    @Param('id') shipmentId: string
  ) {
    const shipment = await this.shipmentsService.getById(shipmentId)
    // Verify ownership
    if (shipment.customerId !== user.id) {
      throw new ForbiddenException()
    }
    return shipment
  }
}
```

### Create a DTO (Data Transfer Object)

```typescript
// src/modules/shipments/dto/create-shipment.dto.ts
import { IsObject, IsString, IsNumber, ValidateNested } from 'class-validator'

class LocationDto {
  @IsNumber()
  latitude: number

  @IsNumber()
  longitude: number

  @IsString()
  address: string

  @IsString()
  instruction?: string
}

class PackageDto {
  @IsString()
  description: string

  @IsNumber()
  weightKg: number
}

export class CreateShipmentDto {
  @ValidateNested()
  pickupLocation: LocationDto

  @ValidateNested()
  dropoffLocation: LocationDto

  @ValidateNested()
  package: PackageDto
}
```

### Database Entity (TypeORM)

```typescript
// src/database/entities/shipment.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm'
import { User } from './user.entity'

@Entity('shipments')
export class Shipment {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column('uuid')
  customerId: string

  @ManyToOne(() => User)
  customer: User

  @Column('varchar')
  status: 'CREATED' | 'QUOTED' | 'CONFIRMED' | 'ASSIGNED' | 'IN_TRANSIT' | 'DELIVERED' | 'COMPLETED' | 'CANCELLED'

  @Column('jsonb')
  pickupLocation: { latitude: number; longitude: number; address: string }

  @Column('jsonb')
  dropoffLocation: { latitude: number; longitude: number; address: string }

  @Column('varchar')
  packageDescription: string

  @Column('decimal', { precision: 8, scale: 2 })
  packageWeightKg: number

  @Column('decimal', { precision: 12, scale: 2 })
  price: number

  @Column('uuid', { nullable: true })
  riderId: string

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}
```

### Handle Errors Globally

```typescript
// src/common/filters/http-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common'

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private logger = new Logger('HttpExceptionFilter')

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse()
    const request = ctx.getRequest()

    let status = 500
    let message = 'Internal server error'
    let details = null

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const resp = exception.getResponse()
      message = resp['message'] || exception.message
      details = resp['details'] || null
    } else if (exception instanceof Error) {
      message = exception.message
    }

    // Log error
    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url}: ${message}`, exception)
    }

    response.status(status).json({
      error: 'ERROR_CODE', // Standardize error codes
      message,
      details,
      timestamp: new Date().toISOString()
    })
  }
}
```

---

## 5. FRONTEND DEVELOPMENT (React)

### Create a New Page

```typescript
// apps/web/src/pages/create-shipment/CreateShipmentPage.tsx
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShipments } from '../../hooks/useShipments'
import { CreateShipmentForm } from '../../components/shipment/CreateShipmentForm'

export function CreateShipmentPage() {
  const navigate = useNavigate()
  const { create, isLoading, error } = useShipments()

  const handleSubmit = async (data) => {
    try {
      const shipment = await create(data)
      navigate(`/track/${shipment.id}`)
    } catch (err) {
      console.error('Failed to create shipment:', err)
    }
  }

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Create Shipment</h1>
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error.message}
        </div>
      )}
      <CreateShipmentForm onSubmit={handleSubmit} isLoading={isLoading} />
    </div>
  )
}
```

### Create a Hook (API calls)

```typescript
// apps/web/src/hooks/useShipments.ts
import { useQuery, useMutation, useQueryClient } from 'react-query'
import { shipmentsApi } from '../services/api'

export function useShipments() {
  const queryClient = useQueryClient()

  const { data: shipments, isLoading: isLoadingList } = useQuery(
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

  const trackMutation = useMutation(
    (shipmentId) => shipmentsApi.getTracking(shipmentId),
    {
      onSuccess: (data) => {
        // Handle tracking data (real-time updates via WebSocket)
      }
    }
  )

  return {
    shipments,
    isLoading: isLoadingList,
    create: createMutation.mutate,
    track: trackMutation.mutate,
    error: createMutation.error
  }
}
```

### Create a Component

```typescript
// apps/web/src/components/shipment/CreateShipmentForm.tsx
import React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const schema = z.object({
  pickupAddress: z.string().min(5),
  dropoffAddress: z.string().min(5),
  packageDescription: z.string(),
  packageWeightKg: z.number().positive()
})

type FormData = z.infer<typeof schema>

interface Props {
  onSubmit: (data: FormData) => Promise<void>
  isLoading: boolean
}

export function CreateShipmentForm({ onSubmit, isLoading }: Props) {
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema)
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="block text-sm font-medium">Pickup Address</label>
        <input
          {...register('pickupAddress')}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
        />
        {errors.pickupAddress && (
          <span className="text-red-500 text-sm">{errors.pickupAddress.message}</span>
        )}
      </div>

      {/* More fields... */}

      <button
        type="submit"
        disabled={isLoading}
        className="w-full bg-blue-500 text-white py-2 rounded-md hover:bg-blue-600 disabled:opacity-50"
      >
        {isLoading ? 'Creating...' : 'Create Shipment'}
      </button>
    </form>
  )
}
```

### State Management (Zustand)

```typescript
// apps/web/src/store/authStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  user: { id: string; phone: string; role: string } | null
  token: string | null
  login: (phone: string, password: string) => Promise<void>
  logout: () => void
  isAuthenticated: boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      login: async (phone, password) => {
        try {
          const response = await authApi.login(phone, password)
          set({
            user: response.user,
            token: response.token,
            isAuthenticated: true
          })
        } catch (error) {
          set({ isAuthenticated: false })
          throw error
        }
      },

      logout: () => {
        set({ user: null, token: null, isAuthenticated: false })
      }
    }),
    {
      name: 'auth-store'
    }
  )
)
```

---

## 6. MOBILE DEVELOPMENT (React Native)

### Setup React Native Project

```bash
# Create new React Native project
npx create-expo-app wazzar-mobile

# Or with TypeScript
npx create-expo-app wazzar-mobile --template

# Navigate to project
cd wazzar-mobile

# Install dependencies
npm install
npm install react-navigation react-native-gesture-handler
```

### Main App Structure

```typescript
// App.tsx
import React, { useEffect, useState } from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useAuthStore } from './src/store/authStore'
import { LoginScreen } from './src/screens/LoginScreen'
import { HomeScreen } from './src/screens/HomeScreen'
import { TrackingScreen } from './src/screens/TrackingScreen'

const Stack = createNativeStackNavigator()

export default function App() {
  const { isAuthenticated, user } = useAuthStore()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Check if user is already logged in
    const checkAuth = async () => {
      // Check localStorage/secure storage
      setIsLoading(false)
    }
    checkAuth()
  }, [])

  if (isLoading) {
    return <SplashScreen />
  }

  return (
    <NavigationContainer>
      <Stack.Navigator>
        {!isAuthenticated ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Signup" component={SignupScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Tracking" component={TrackingScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  )
}
```

### Screen Example

```typescript
// src/screens/TrackingScreen.tsx
import React, { useEffect, useState } from 'react'
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native'
import MapView, { Marker } from 'react-native-maps'
import { useRoute } from '@react-navigation/native'
import { useShipmentTracking } from '../hooks/useShipmentTracking'

export function TrackingScreen() {
  const route = useRoute()
  const { shipmentId } = route.params
  const { tracking, isLoading } = useShipmentTracking(shipmentId)

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: tracking.riderLocation.latitude,
          longitude: tracking.riderLocation.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05
        }}
      >
        <Marker
          coordinate={tracking.riderLocation}
          title="Rider"
          pinColor="blue"
        />
        <Marker
          coordinate={tracking.pickupLocation}
          title="Pickup"
          pinColor="green"
        />
        <Marker
          coordinate={tracking.dropoffLocation}
          title="Dropoff"
          pinColor="red"
        />
      </MapView>

      <View style={styles.info}>
        <Text style={styles.title}>Status: {tracking.status}</Text>
        <Text>ETA: {tracking.eta} minutes</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  info: { padding: 16, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: 'bold' }
})
```

### Using Async Storage (Persistent Data)

```typescript
// src/hooks/useAsyncStorage.ts
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useState } from 'react'

export function useAsyncStorage(key: string) {
  const [value, setValue] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    AsyncStorage.getItem(key).then((data) => {
      if (data) setValue(JSON.parse(data))
      setIsLoading(false)
    })
  }, [key])

  const setAsyncValue = async (newValue: any) => {
    setValue(newValue)
    await AsyncStorage.setItem(key, JSON.stringify(newValue))
  }

  return [value, setAsyncValue, isLoading]
}
```

---

## 7. DATABASE DEVELOPMENT

### Create a Migration

```bash
# Generate migration
npm run typeorm migration:create src/database/migrations/CreateShipmentsTable

# Or use NestJS CLI
npm run g migration CreateShipmentsTable
```

### Write Migration

```typescript
// src/database/migrations/1692360000000-CreateShipmentsTable.ts
import { MigrationInterface, QueryRunner, Table } from 'typeorm'

export class CreateShipmentsTable1692360000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'shipments',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()'
          },
          {
            name: 'customer_id',
            type: 'uuid'
          },
          {
            name: 'status',
            type: 'varchar'
          },
          {
            name: 'price',
            type: 'decimal',
            precision: 12,
            scale: 2
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'NOW()'
          }
        ],
        foreignKeys: [
          {
            columnNames: ['customer_id'],
            referencedTableName: 'users',
            referencedColumnNames: ['id']
          }
        ]
      })
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('shipments')
  }
}
```

### Run Migrations

```bash
# Run pending migrations
npm run db:migrate

# Revert last migration
npm run db:migrate:revert

# Show migration status
npm run db:migrate:show
```

### Seed Development Data

```typescript
// src/database/seeds/create-test-data.seed.ts
import { Seeder } from 'typeorm-extension'
import { DataSource } from 'typeorm'
import { User } from '../entities/user.entity'
import * as bcrypt from 'bcryptjs'

export class CreateInitialData1692360000000 implements Seeder {
  public async run(dataSource: DataSource): Promise<any> {
    const repository = dataSource.getRepository(User)

    await repository.insert([
      {
        phone: '+255758123456',
        email: 'customer@wazzar.tz',
        passwordHash: await bcrypt.hash('password123', 10),
        fullName: 'John Customer',
        role: 'CUSTOMER'
      },
      {
        phone: '+255758234567',
        email: 'rider@wazzar.tz',
        passwordHash: await bcrypt.hash('password123', 10),
        fullName: 'Ahmed Rider',
        role: 'RIDER'
      }
    ])
  }
}
```

```bash
# Run seeds
npm run db:seed
```

---

## 8. API DEVELOPMENT

### Creating a New Endpoint

**Step 1: Create DTO**

```typescript
// src/modules/shipments/dto/rate-shipment.dto.ts
export class RateShipmentDto {
  @IsInt()
  @Min(1)
  @Max(5)
  score: number

  @IsString()
  @IsOptional()
  comment?: string
}
```

**Step 2: Add Service Method**

```typescript
// In ShipmentsService
async rateShipment(shipmentId: string, dto: RateShipmentDto): Promise<Rating> {
  const shipment = await this.shipmentsRepo.findOne({ where: { id: shipmentId } })
  if (!shipment) throw new NotFoundException()

  const rating = this.ratingsRepo.create({
    shipmentId,
    score: dto.score,
    comment: dto.comment
  })

  await this.ratingsRepo.save(rating)

  // Update rider's average rating
  await this.updateRiderRating(shipment.riderId)

  return rating
}
```

**Step 3: Add Controller Endpoint**

```typescript
// In ShipmentsController
@Post(':id/rate')
async rate(@Param('id') shipmentId: string, @Body() dto: RateShipmentDto) {
  return this.shipmentsService.rateShipment(shipmentId, dto)
}
```

**Step 4: Test Endpoint**

```bash
# Test with curl
curl -X POST http://localhost:3000/api/v1/shipments/uuid/rate \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"score": 5, "comment": "Great delivery!"}'

# Or use Postman/Insomnia
```

### API Documentation (Swagger/OpenAPI)

```typescript
// Install Swagger
npm install @nestjs/swagger swagger-ui-express

// In main.ts
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'

const config = new DocumentBuilder()
  .setTitle('WAZZAR API')
  .setDescription('The WAZZAR delivery API documentation')
  .setVersion('1.0')
  .addBearerAuth()
  .build()

const document = SwaggerModule.createDocument(app, config)
SwaggerModule.setup('api/docs', app, document)
```

```typescript
// Decorate endpoints
import { ApiOperation, ApiResponse } from '@nestjs/swagger'

@Post()
@ApiOperation({ summary: 'Create a new shipment' })
@ApiResponse({ status: 201, description: 'Shipment created' })
@ApiResponse({ status: 400, description: 'Invalid input' })
async create(@Body() dto: CreateShipmentDto) {
  // ...
}
```

### Access API documentation at http://localhost:3000/api/docs

---

## 9. ADDING FEATURES (STEP-BY-STEP WORKFLOW)

### Example: Add "Rider Earnings Dashboard"

**Step 1: Read Blueprint**

Find relevant requirement:
> "Riders can view daily/weekly earnings, withdrawal history, and payout status"

**Step 2: Define User Story**

```
As a Rider
I want to see my earnings breakdown
So that I can understand my income
```

**Step 3: Define Data Model**

```sql
-- New table: rider_earnings
CREATE TABLE rider_earnings (
  id UUID PRIMARY KEY,
  rider_id UUID REFERENCES riders(id),
  shipment_id UUID REFERENCES shipments(id),
  amount DECIMAL(12, 2),
  earned_at TIMESTAMP,
  payout_status ENUM('PENDING', 'PAID')
)
```

**Step 4: Define API Endpoint**

```
GET /api/v1/rider/earnings?period=week

Response:
{
  "totalEarnings": 125000,
  "currency": "TZS",
  "period": "week",
  "earnings": [
    {
      "date": "2026-08-18",
      "shipments": 5,
      "amount": 18000,
      "pending": 0
    },
    ...
  ],
  "payouts": [
    {
      "id": "uuid",
      "amount": 100000,
      "status": "PAID",
      "paidAt": "2026-08-17T12:00:00Z"
    }
  ]
}
```

**Step 5: Implement Backend**

```bash
# 1. Create migration
npm run typeorm migration:create src/database/migrations/CreateRiderEarningsTable

# 2. Create entity
# src/database/entities/rider-earnings.entity.ts

# 3. Create service
npm run g service modules/rider-earnings/rider-earnings

# 4. Add methods to RiderEarningsService
async getEarnings(riderId, period = 'week') { ... }
async getPayout(payoutId) { ... }
async requestWithdrawal(riderId, amount) { ... }

# 5. Create controller
npm run g controller modules/rider-earnings/rider-earnings

# 6. Add endpoints to RiderEarningsController
@Get()
async getEarnings(@Query() params) { ... }
```

**Step 6: Implement Frontend**

```typescript
// 1. Create hook
// apps/web/src/hooks/useRiderEarnings.ts
export function useRiderEarnings() {
  const { data, isLoading } = useQuery(
    ['earnings'],
    () => riderApi.getEarnings()
  )
  return { earnings: data, isLoading }
}

// 2. Create page
// apps/web/src/pages/earnings/EarningsPage.tsx
export function EarningsPage() {
  const { earnings, isLoading } = useRiderEarnings()
  return (
    <div>
      <EarningsChart data={earnings} />
      <EarningsTable data={earnings} />
      <WithdrawalButton />
    </div>
  )
}

// 3. Create components
// apps/web/src/components/earnings/EarningsChart.tsx
// apps/web/src/components/earnings/EarningsTable.tsx
```

**Step 7: Add Tests**

```typescript
// 1. Service tests
describe('RiderEarningsService', () => {
  it('should calculate earnings for week', async () => {
    const earnings = await service.getEarnings('rider_id', 'week')
    expect(earnings.totalEarnings).toBeGreaterThan(0)
  })
})

// 2. API tests
describe('GET /rider/earnings', () => {
  it('should return earnings for authenticated rider', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/rider/earnings?period=week')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('totalEarnings')
  })
})

// 3. E2E tests (from user perspective)
describe('Rider earnings flow', () => {
  it('should show earnings and allow withdrawal', async () => {
    // 1. Login as rider
    // 2. Navigate to earnings
    // 3. Verify earnings displayed
    // 4. Click withdraw
    // 5. Verify withdrawal initiated
  })
})
```

**Step 8: Update Documentation**

- Update API docs (Swagger)
- Update README
- Add user guide
- Create ADR (Architecture Decision Record)

**Step 9: Deploy to Staging**

```bash
git commit -m "feat: Add rider earnings dashboard"
git push origin feature/rider-earnings
# Create PR, get review, merge to staging
# Test in staging
# Merge to main for production
```

---

## 10. TESTING GUIDE

### Unit Tests (Vitest/Jest)

```typescript
// src/modules/pricing/pricing.service.spec.ts
import { Test } from '@nestjs/testing'
import { PricingService } from './pricing.service'

describe('PricingService', () => {
  let service: PricingService

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [PricingService]
    }).compile()

    service = module.get(PricingService)
  })

  describe('calculatePrice', () => {
    it('should calculate price based on distance and weight', async () => {
      const price = await service.calculate({
        origin: { lat: -6.792, lng: 39.208 },
        destination: { lat: -6.801, lng: 39.215 },
        weightKg: 1.5
      })

      expect(price.total).toBeGreaterThan(0)
      expect(price).toHaveProperty('basePrice')
      expect(price).toHaveProperty('distanceCost')
      expect(price).toHaveProperty('weightCost')
    })

    it('should apply demand multiplier', async () => {
      const priceLowDemand = await service.calculate({...}, 1.0)
      const priceHighDemand = await service.calculate({...}, 1.5)
      expect(priceHighDemand.total).toBeGreaterThan(priceLowDemand.total)
    })
  })
})
```

### Integration Tests

```typescript
// src/modules/shipments/shipments.integration.spec.ts
describe('Shipments Integration Tests', () => {
  let app
  let shipmentsService
  let paymentsService

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ShipmentsModule, PaymentsModule]
    }).compile()

    app = module.createNestApplication()
    shipmentsService = module.get(ShipmentsService)
    paymentsService = module.get(PaymentsService)
  })

  it('should complete full shipment lifecycle', async () => {
    // 1. Create shipment
    const shipment = await shipmentsService.create('customer_id', {
      pickupLocation: {...},
      dropoffLocation: {...},
      package: {...}
    })
    expect(shipment.status).toBe('CREATED')

    // 2. Make payment
    const payment = await paymentsService.initiate(shipment.id, 4250, 'CARD')
    expect(payment.status).toBe('PROCESSING')

    // Simulate payment callback
    await paymentsService.handleCallback({ transactionId: payment.id })
    expect(payment.status).toBe('COMPLETED')

    // 3. Verify shipment status changed
    const updated = await shipmentsService.getById(shipment.id)
    expect(updated.status).toBe('CONFIRMED')
  })
})
```

### API Tests (E2E)

```typescript
// test/shipments.e2e.spec.ts
describe('Shipments API (e2e)', () => {
  let app

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule]
    }).compile()

    app = module.createNestApplication()
    await app.init()
  })

  it('POST /api/v1/shipments should create shipment', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/shipments')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        pickupLocation: { address: '46 Morogoro Road', latitude: -6.792, longitude: 39.208 },
        dropoffLocation: { address: 'Samora Avenue', latitude: -6.801, longitude: 39.215 },
        package: { description: 'Documents', weightKg: 0.5 }
      })

    expect(response.status).toBe(201)
    expect(response.body).toHaveProperty('shipmentId')
    expect(response.body.status).toBe('QUOTED')
    expect(response.body.price).toBeGreaterThan(0)
  })

  it('should return 401 if not authenticated', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/shipments')
      .send({...})

    expect(response.status).toBe(401)
  })

  it('should return 400 if missing required fields', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/shipments')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ pickup Location: {...} })  // Missing dropoffLocation

    expect(response.status).toBe(400)
  })
})
```

### Run Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:cov

# Run specific test file
npm test shipments.service

# Run tests for mobile
cd apps/mobile && npm test
```

---

## 11. DEPLOYMENT GUIDE

### Deploy to Staging

```bash
# 1. Merge to staging branch
git checkout staging
git pull
git merge feature/your-feature

# 2. Run CI/CD pipeline (automated)
# GitHub Actions will:
# - Run linting
# - Run tests
# - Build artifacts
# - Deploy to staging

# 3. Manual verification
# Visit https://staging.wazzar.tz
# Test core features
# Check logs

# 4. If OK, merge to main
git checkout main
git merge staging
git push origin main
```

### Deploy to Production

```bash
# 1. Tagged release
git tag v1.0.0
git push origin v1.0.0

# 2. GitHub Actions automatically:
# - Builds production image
# - Runs security scan
# - Deploys to production (blue-green)
# - Runs smoke tests

# 3. Monitor
# Watch dashboards
# Check error rate
# Monitor server health

# 4. Rollback if needed
# Automated: Click "Rollback" button
# Or manual: Restore previous tag
```

### Environment-Specific Configs

```bash
# .env.staging
DATABASE_URL=postgresql://...staging-db...
REDIS_URL=redis://...staging...
STRIPE_SECRET_KEY=sk_test_...

# .env.production
DATABASE_URL=postgresql://...prod-db...
REDIS_URL=redis://...prod...
STRIPE_SECRET_KEY=sk_live_...
```

### Database Migrations in Production

```bash
# Safe migration process:
# 1. Backup database
npm run db:backup

# 2. Run migration on staging first
npm run db:migrate:staging

# 3. Test extensively
# 4. Run on production
npm run db:migrate:production

# 5. Verify data integrity
npm run db:validate

# 6. Rollback if needed
npm run db:migrate:rollback
```

---

## 12. TROUBLESHOOTING

### Common Issues

**"ENOENT: no such file or directory"**

```bash
# Problem: Missing node_modules
# Solution:
rm -rf node_modules package-lock.json
npm install
```

**"Port 3000 is already in use"**

```bash
# Find process using port
lsof -i :3000

# Kill it
kill -9 <PID>

# Or use different port
PORT=3001 npm run dev
```

**"Database connection refused"**

```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# Restart if needed
docker restart wazzar-postgres

# Verify connection string
echo $DATABASE_URL
```

**"Invalid JWT token"**

```bash
# Generate new token in development
# Use admin panel to generate test tokens
# Or add route for dev token generation:
@Get('/dev/token')
generateDevToken() {
  return jwt.sign({ userId: 'dev', role: 'ADMIN' }, process.env.JWT_SECRET)
}
```

**Tests failing with "Cannot find module"**

```bash
# Clear Jest cache
npm test -- --clearCache

# Check tsconfig.json paths
npm run type-check
```

---

## 13. SECURITY CHECKLIST

Before each deployment:

- [ ] No secrets in code (use environment variables)
- [ ] All endpoints require authentication where needed
- [ ] Authorization checks on all protected endpoints
- [ ] Input validation on all forms/APIs
- [ ] SQL injection prevention (using ORM)
- [ ] XSS prevention (React auto-escapes)
- [ ] CORS configured for allowed origins only
- [ ] Rate limiting enabled on login, payment endpoints
- [ ] HTTPS/TLS in production
- [ ] Password hashing (bcrypt)
- [ ] Error messages don't leak sensitive info
- [ ] Audit logging for important actions
- [ ] OWASP dependency check passed
- [ ] No hardcoded credentials
- [ ] Database backups configured
- [ ] Monitoring/alerting configured

---

## 14. PERFORMANCE OPTIMIZATION

### Frontend

```typescript
// Code splitting
const CreateShipmentPage = lazy(() => import('./pages/CreateShipmentPage'))

// Image optimization
<img src={image} alt="..." loading="lazy" />

// Memoization
const ExpensiveComponent = React.memo(Component)

// useCallback to prevent rerenders
const handleClick = useCallback(() => {...}, [dependency])
```

### Backend

```typescript
// Database indexes
CREATE INDEX idx_shipments_customer_created ON shipments(customer_id, created_at DESC)

// Query optimization
const shipments = await shipmentsRepo.find({
  relations: ['customer', 'rider'], // Load related data
  select: ['id', 'status', 'price'] // Only needed columns
})

// Caching
@Cacheable('shipment:{id}', 3600) // 1 hour cache
async getShipment(id: string) {...}

// Pagination
async list(page = 1, limit = 20) {
  return shipmentsRepo.find({
    skip: (page - 1) * limit,
    take: limit
  })
}
```

### Redis

```typescript
// Cache frequently accessed data
const rider = await redis.get(`rider:${riderId}`)
if (!rider) {
  rider = await db.riders.findOne(riderId)
  await redis.set(`rider:${riderId}`, JSON.stringify(rider), 'EX', 3600)
}
```

---

## END OF BUILD COOKBOOK

Use this guide when:
- Setting up local development
- Adding new features
- Debugging issues
- Deploying to production
- Onboarding new developers

For more details, see:
- WAZZAR_SYSTEM_ARCHITECTURE.md
- WAZZAR_BLUEPRINT_AUDIT.md
- API documentation (http://localhost:3000/api/docs)

