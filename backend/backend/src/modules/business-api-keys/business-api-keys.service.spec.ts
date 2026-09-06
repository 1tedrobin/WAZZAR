import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { BusinessApiKeysService } from './business-api-keys.service';
import { ApiKey, ApiKeyScope, ApiKeyStatus } from '../../database/entities/api-key.entity';

function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: x.id ?? 'key-1', ...x })),
    find: jest.fn(),
    findOne: jest.fn(),
  };
}

const BUSINESS_ID = 'a5f3c111-0000-4000-8000-000000000001';
const OTHER_BUSINESS_ID = 'a5f3c111-0000-4000-8000-000000000099';
const KEY_ID = 'c5f3c111-0000-4000-8000-000000000001';

function keyRow(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: KEY_ID,
    businessId: BUSINESS_ID,
    name: 'Warehouse integration',
    keyPrefix: 'wzr_live_ab12cd34',
    keyHash: 'irrelevant-for-most-tests',
    scopes: [ApiKeyScope.SHIPMENTS_READ],
    status: ApiKeyStatus.ACTIVE,
    lastUsedAt: null,
    requestCount: 0,
    createdAt: new Date(),
    revokedAt: null,
    ...overrides,
  } as ApiKey;
}

describe('BusinessApiKeysService', () => {
  let service: BusinessApiKeysService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    repo = mockRepo();
    const module: TestingModule = await Test.createTestingModule({
      providers: [BusinessApiKeysService, { provide: getRepositoryToken(ApiKey), useValue: repo }],
    }).compile();
    service = module.get(BusinessApiKeysService);
  });

  describe('create', () => {
    it('generates a wzr_live_-prefixed key, hashes it, and returns the plaintext key exactly once', async () => {
      const result = await service.create(BUSINESS_ID, {
        name: 'Warehouse integration',
        scopes: [ApiKeyScope.SHIPMENTS_WRITE],
      });

      expect(result.key).toMatch(/^wzr_live_[0-9a-f]{48}$/);
      expect(result.keyPrefix).toBe(result.key.slice(0, 17));

      const savedArg = repo.create.mock.calls[0][0];
      expect(savedArg.businessId).toBe(BUSINESS_ID);
      expect(savedArg.name).toBe('Warehouse integration');
      expect(savedArg.scopes).toEqual([ApiKeyScope.SHIPMENTS_WRITE]);
      expect(savedArg.status).toBe(ApiKeyStatus.ACTIVE);
      // The stored hash must never equal the plaintext key, and must
      // actually verify against it via bcrypt.
      expect(savedArg.keyHash).not.toBe(result.key);
      await expect(bcrypt.compare(result.key, savedArg.keyHash)).resolves.toBe(true);
    });
  });

  describe('list', () => {
    it("returns only the calling business's own keys, newest first, without the hash", async () => {
      repo.find.mockResolvedValue([keyRow()]);

      const result = await service.list(BUSINESS_ID);

      expect(repo.find).toHaveBeenCalledWith({
        where: { businessId: BUSINESS_ID },
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('keyHash');
    });
  });

  describe('revoke', () => {
    it('marks an owned, active key revoked', async () => {
      repo.findOne.mockResolvedValue(keyRow());

      const result = await service.revoke(BUSINESS_ID, KEY_ID);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ApiKeyStatus.REVOKED, revokedAt: expect.any(Date) }),
      );
      expect(result.status).toBe(ApiKeyStatus.REVOKED);
      expect(result).not.toHaveProperty('keyHash');
    });

    it('throws ConflictException for an already-revoked key', async () => {
      repo.findOne.mockResolvedValue(keyRow({ status: ApiKeyStatus.REVOKED }));

      await expect(service.revoke(BUSINESS_ID, KEY_ID)).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException for a nonexistent key', async () => {
      repo.findOne.mockResolvedValue(undefined);

      await expect(service.revoke(BUSINESS_ID, KEY_ID)).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException instead of revoking another business's key", async () => {
      repo.findOne.mockResolvedValue(keyRow({ businessId: OTHER_BUSINESS_ID }));

      await expect(service.revoke(BUSINESS_ID, KEY_ID)).rejects.toThrow(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('validateKey', () => {
    it('returns the matching key and records usage when the raw key is correct', async () => {
      const rawKey = 'wzr_live_deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      const keyHash = await bcrypt.hash(rawKey, 4);
      repo.find.mockResolvedValue([keyRow({ keyHash, requestCount: 3 })]);

      const result = await service.validateKey(rawKey);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(KEY_ID);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ requestCount: 4, lastUsedAt: expect.any(Date) }),
      );
    });

    it('returns null for a key with the right prefix but wrong secret', async () => {
      const keyHash = await bcrypt.hash('wzr_live_correctsecretvalue', 4);
      repo.find.mockResolvedValue([keyRow({ keyPrefix: 'wzr_live_ab12cd34', keyHash })]);

      const result = await service.validateKey('wzr_live_ab12cd34wrongsecretvalue');

      expect(result).toBeNull();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('returns null without querying the repo for a key with no wzr_live_ prefix', async () => {
      const result = await service.validateKey('sk_some_other_provider_key');

      expect(result).toBeNull();
      expect(repo.find).not.toHaveBeenCalled();
    });

    it('returns null when no candidate matches the prefix', async () => {
      repo.find.mockResolvedValue([]);

      const result = await service.validateKey('wzr_live_ab12cd34somesecrethere');

      expect(result).toBeNull();
    });
  });
});
