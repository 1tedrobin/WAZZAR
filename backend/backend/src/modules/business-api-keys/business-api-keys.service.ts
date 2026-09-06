import { randomBytes } from 'crypto';
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { ApiKey, ApiKeyStatus } from '../../database/entities/api-key.entity';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

// Same salt cost as user password hashing (auth.service.ts) — no
// reason for API-key hashing to be weaker, and keeping it identical
// means one BCRYPT_SALT_ROUNDS decision to revisit later, not two.
const BCRYPT_SALT_ROUNDS = 10;

// "wzr_live_" so a leaked key is instantly recognizable as a WAZZAR
// credential in a scan/grep of a customer's leaked env file or repo —
// the same reasoning Stripe/GitHub prefix their own tokens for. No
// "test" variant yet since there's no sandbox mode for the public API
// itself (only for the payment providers behind it).
const KEY_PREFIX = 'wzr_live_';
// Non-secret prefix length stored in the clear for fast lookup —
// KEY_PREFIX plus an 8-hex-char slice of the random secret. Long
// enough that prefix collisions across different businesses' keys are
// rare in practice (candidates within a matching prefix are still
// individually bcrypt-compared, so a collision only costs an extra
// compare, never a false authentication).
const PREFIX_VISIBLE_CHARS = 8;

export interface CreatedApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: ApiKey['scopes'];
  status: ApiKeyStatus;
  createdAt: Date;
  // Only ever present in the create() response — never stored, never
  // returned again by list().
  key: string;
}

export type SafeApiKey = Omit<ApiKey, 'keyHash'>;

@Injectable()
export class BusinessApiKeysService {
  constructor(
    @InjectRepository(ApiKey)
    private readonly repo: Repository<ApiKey>,
  ) {}

  async create(businessId: string, dto: CreateApiKeyDto): Promise<CreatedApiKey> {
    const secret = randomBytes(24).toString('hex');
    const rawKey = `${KEY_PREFIX}${secret}`;
    const keyPrefix = rawKey.slice(0, KEY_PREFIX.length + PREFIX_VISIBLE_CHARS);
    const keyHash = await bcrypt.hash(rawKey, BCRYPT_SALT_ROUNDS);

    const entry = this.repo.create({
      businessId,
      name: dto.name,
      keyPrefix,
      keyHash,
      scopes: dto.scopes,
      status: ApiKeyStatus.ACTIVE,
      lastUsedAt: null,
      requestCount: 0,
      revokedAt: null,
    });
    const saved = await this.repo.save(entry);

    // The one and only time the plaintext key is ever available —
    // callers must copy it now; it's unrecoverable afterwards (see
    // list(), which never returns keyHash or the raw key).
    return {
      id: saved.id,
      name: saved.name,
      keyPrefix: saved.keyPrefix,
      scopes: saved.scopes,
      status: saved.status,
      createdAt: saved.createdAt,
      key: rawKey,
    };
  }

  // Newest-first, same convention as every other business-owned list
  // in this codebase (business-customers, business-staff, ...).
  async list(businessId: string): Promise<SafeApiKey[]> {
    const rows = await this.repo.find({ where: { businessId }, order: { createdAt: 'DESC' } });
    return rows.map(omitHash);
  }

  async revoke(businessId: string, id: string): Promise<SafeApiKey> {
    const entry = await this.findOwnedOrThrow(businessId, id);
    if (entry.status === ApiKeyStatus.REVOKED) {
      throw new ConflictException('This key is already revoked');
    }
    entry.status = ApiKeyStatus.REVOKED;
    entry.revokedAt = new Date();
    const saved = await this.repo.save(entry);
    return omitHash(saved);
  }

  // Not just findOne(id) — a business must never be able to see or
  // revoke another business's key by guessing a UUID, same ownership-
  // scoping pattern as every other business-* module in this repo.
  private async findOwnedOrThrow(businessId: string, id: string): Promise<ApiKey> {
    const entry = await this.repo.findOne({ where: { id } });
    if (!entry) {
      throw new NotFoundException(`API key ${id} not found`);
    }
    if (entry.businessId !== businessId) {
      throw new ForbiddenException('You do not have access to this API key');
    }
    return entry;
  }

  // Used by ApiKeyAuthGuard, not the business-facing controller. Given
  // a raw key from an incoming request's X-API-Key header: narrow to
  // ACTIVE rows sharing its prefix (cheap, indexed), then bcrypt-
  // compare each candidate (expensive, but there should only ever be
  // one or two rows sharing a given prefix). Returns null rather than
  // throwing — the guard decides what an invalid key means for the
  // HTTP response, this method just answers "does this key work".
  async validateKey(rawKey: string): Promise<ApiKey | null> {
    if (!rawKey.startsWith(KEY_PREFIX)) {
      return null;
    }
    const keyPrefix = rawKey.slice(0, KEY_PREFIX.length + PREFIX_VISIBLE_CHARS);
    const candidates = await this.repo.find({
      where: { keyPrefix, status: ApiKeyStatus.ACTIVE },
    });

    for (const candidate of candidates) {
      if (await bcrypt.compare(rawKey, candidate.keyHash)) {
        candidate.lastUsedAt = new Date();
        candidate.requestCount += 1;
        await this.repo.save(candidate);
        return candidate;
      }
    }
    return null;
  }
}

function omitHash(entry: ApiKey): SafeApiKey {
  // This project's no-unused-vars config (see .eslintrc.js) only
  // ignores underscore-prefixed function *arguments*, not destructured
  // variables, so the standard "destructure to omit a field" pattern
  // needs an explicit disable here rather than a naming convention.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { keyHash, ...safe } = entry;
  return safe;
}
