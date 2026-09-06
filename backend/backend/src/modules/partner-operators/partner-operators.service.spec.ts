import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PartnerOperatorsService } from './partner-operators.service';
import {
  PartnerOperator,
  PartnerOperatorStatus,
} from '../../database/entities/partner-operator.entity';

function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: x.id ?? 'operator-1', ...x })),
    find: jest.fn(),
    findOne: jest.fn(),
  };
}

const OPERATOR_ID = 'a5f3c111-0000-4000-8000-000000000001';

function operator(overrides: Partial<PartnerOperator> = {}): PartnerOperator {
  return {
    id: OPERATOR_ID,
    name: 'Kilimanjaro Express',
    phone: '0754000000',
    email: 'ops@kilimanjaroexpress.example',
    apiKeyHash: 'hashed',
    latraApiKey: null,
    status: PartnerOperatorStatus.ACTIVE,
    createdAt: new Date(),
    ...overrides,
  } as PartnerOperator;
}

describe('PartnerOperatorsService', () => {
  let service: PartnerOperatorsService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    repo = mockRepo();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartnerOperatorsService,
        { provide: getRepositoryToken(PartnerOperator), useValue: repo },
      ],
    }).compile();
    service = module.get(PartnerOperatorsService);
  });

  describe('create', () => {
    it('returns a raw API key shaped <operatorId>.<secret>, storing only its hash', async () => {
      repo.save.mockImplementation(async (x) => ({ id: OPERATOR_ID, ...x }));

      const result = await service.create({ name: 'Kilimanjaro Express' });

      expect(result.apiKey.startsWith(`${OPERATOR_ID}.`)).toBe(true);
      expect(result.operator.apiKeyHash).not.toBe(result.apiKey);
      expect(result.operator.apiKeyHash).not.toBe('pending');

      const secret = result.apiKey.slice(`${OPERATOR_ID}.`.length);
      await expect(bcrypt.compare(secret, result.operator.apiKeyHash)).resolves.toBe(true);
    });
  });

  describe('rotateKey', () => {
    it('issues a new key that invalidates the old hash', async () => {
      repo.findOne.mockResolvedValue(operator());
      repo.save.mockImplementation(async (x) => x);

      const result = await service.rotateKey(OPERATOR_ID);

      expect(result.apiKey.startsWith(`${OPERATOR_ID}.`)).toBe(true);
      expect(result.operator.apiKeyHash).not.toBe('hashed');
    });

    it('throws NotFoundException for a nonexistent operator', async () => {
      repo.findOne.mockResolvedValue(undefined);

      await expect(service.rotateKey(OPERATOR_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('verifyApiKey', () => {
    it('resolves the operator when the key matches', async () => {
      const realHash = await bcrypt.hash('real-secret', 4);
      repo.findOne.mockResolvedValue(operator({ apiKeyHash: realHash }));

      const result = await service.verifyApiKey(`${OPERATOR_ID}.real-secret`);

      expect(result?.id).toBe(OPERATOR_ID);
    });

    it('returns null when the secret does not match the stored hash', async () => {
      const realHash = await bcrypt.hash('real-secret', 4);
      repo.findOne.mockResolvedValue(operator({ apiKeyHash: realHash }));

      const result = await service.verifyApiKey(`${OPERATOR_ID}.wrong-secret`);

      expect(result).toBeNull();
    });

    it('returns null when the key has no separator', async () => {
      const result = await service.verifyApiKey('not-a-valid-key');

      expect(result).toBeNull();
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('returns null when the operator id does not exist', async () => {
      repo.findOne.mockResolvedValue(undefined);

      const result = await service.verifyApiKey(`${OPERATOR_ID}.some-secret`);

      expect(result).toBeNull();
    });
  });
});
