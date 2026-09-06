import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { User } from '../../database/entities/user.entity';
import { Role, UserRole } from '../../database/entities/user-role.entity';
import { DEFAULT_MARKET, MarketCountryCode } from '../../common/market';

// No AuthService spec existed before this pass — this covers only the
// new register() market/countryCode logic (the reason this file exists),
// not the full pre-existing surface (login/refresh/getCurrentUser),
// which was already working and untested before this change.

function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: x.id ?? 'user-1', ...x })),
    findOne: jest.fn(),
    find: jest.fn(async () => []),
  };
}

const VALID_DTO = {
  phone: '+255712345678',
  password: 'Str0ng!Pass',
  fullName: 'Asha Mrema',
  role: Role.CUSTOMER,
} as const;

describe('AuthService.register — market/countryCode', () => {
  let service: AuthService;
  let usersRepo: ReturnType<typeof mockRepo>;
  let userRolesRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    usersRepo = mockRepo();
    userRolesRepo = mockRepo();
    usersRepo.findOne.mockResolvedValue(undefined); // no existing account

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(UserRole), useValue: userRolesRepo },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn(async () => 'signed-token') },
        },
        { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('defaults countryCode to TZ (DEFAULT_MARKET) when omitted, with no phone cross-check', async () => {
    await service.register({ ...VALID_DTO });

    expect(usersRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ countryCode: DEFAULT_MARKET }),
    );
  });

  it('stores the explicitly-chosen countryCode when the phone matches it', async () => {
    await service.register({
      ...VALID_DTO,
      phone: '+254712345678',
      countryCode: MarketCountryCode.KE,
    });

    expect(usersRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ countryCode: MarketCountryCode.KE }),
    );
  });

  it('rejects registration when the chosen countryCode does not match the phone number', async () => {
    await expect(
      service.register({
        ...VALID_DTO,
        phone: '+255712345678', // Tanzanian number
        countryCode: MarketCountryCode.KE, // but claims Kenya
      }),
    ).rejects.toThrow(BadRequestException);

    expect(usersRepo.save).not.toHaveBeenCalled();
  });

  it('still rejects a duplicate phone before ever reaching the market check', async () => {
    usersRepo.findOne.mockResolvedValue({ phone: VALID_DTO.phone } as User);

    await expect(
      service.register({ ...VALID_DTO, countryCode: MarketCountryCode.KE }),
    ).rejects.toThrow(ConflictException);
  });
});
