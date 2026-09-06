import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { PartnerOperator } from '../../database/entities/partner-operator.entity';
import { CreatePartnerOperatorDto } from './dto/create-partner-operator.dto';
import { UpdatePartnerOperatorDto } from './dto/update-partner-operator.dto';

// Same salt-rounds constant AuthService uses for password hashing —
// bcrypt cost, not tied to what's being hashed.
const BCRYPT_SALT_ROUNDS = 10;

export interface PartnerOperatorWithKey {
  operator: PartnerOperator;
  // Only ever populated by create()/rotateKey() — the one moment the raw
  // key exists outside this service. Never stored, never returned from
  // any other method.
  apiKey: string;
}

@Injectable()
export class PartnerOperatorsService {
  constructor(
    @InjectRepository(PartnerOperator)
    private readonly repo: Repository<PartnerOperator>,
  ) {}

  // Onboards a new partner operator (ADMIN action — see
  // PartnerOperatorsController). Returns the raw API key exactly once;
  // only its bcrypt hash is persisted. The key is shaped
  // `<operatorId>.<64 hex chars>` so PartnerApiKeyGuard can look up which
  // operator a request claims to be before bcrypt-comparing the secret
  // half — bcrypt hashes aren't reversible, so a bare hash lookup by key
  // alone isn't possible, same reason JWTs carry `sub` instead of being
  // looked up by token content.
  async create(dto: CreatePartnerOperatorDto): Promise<PartnerOperatorWithKey> {
    const operator = this.repo.create({
      name: dto.name,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      apiKeyHash: 'pending', // overwritten below once the id exists
    });
    const saved = await this.repo.save(operator);

    return this.issueNewKey(saved);
  }

  async list(): Promise<PartnerOperator[]> {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  async findOne(id: string): Promise<PartnerOperator> {
    return this.findByIdOrThrow(id);
  }

  async update(id: string, dto: UpdatePartnerOperatorDto): Promise<PartnerOperator> {
    const operator = await this.findByIdOrThrow(id);

    if (dto.name !== undefined) operator.name = dto.name;
    if (dto.phone !== undefined) operator.phone = dto.phone;
    if (dto.email !== undefined) operator.email = dto.email;
    if (dto.status !== undefined) operator.status = dto.status;

    return this.repo.save(operator);
  }

  // Invalidates the old key immediately (overwrites the hash) — the
  // standard "rotate" shape: old key stops working the instant this
  // returns, whether or not the caller has already switched to the new
  // one. No grace-period/dual-key support — flagged as a follow-up if a
  // real partner integration ever needs zero-downtime rotation.
  async rotateKey(id: string): Promise<PartnerOperatorWithKey> {
    const operator = await this.findByIdOrThrow(id);
    return this.issueNewKey(operator);
  }

  // Called by PartnerApiKeyGuard on every partner-authenticated request
  // (see tracking-channels.module.ts). Looks the operator up by the id
  // half of the presented key, then bcrypt-compares the secret half
  // against the stored hash — never trusts the id half alone.
  async verifyApiKey(presentedKey: string): Promise<PartnerOperator | null> {
    const separatorIndex = presentedKey.indexOf('.');
    if (separatorIndex === -1) {
      return null;
    }

    const operatorId = presentedKey.slice(0, separatorIndex);
    const secret = presentedKey.slice(separatorIndex + 1);

    const operator = await this.repo.findOne({ where: { id: operatorId } });
    if (!operator) {
      return null;
    }

    const matches = await bcrypt.compare(secret, operator.apiKeyHash);
    return matches ? operator : null;
  }

  private async issueNewKey(operator: PartnerOperator): Promise<PartnerOperatorWithKey> {
    const secret = randomBytes(32).toString('hex');
    const apiKey = `${operator.id}.${secret}`;

    operator.apiKeyHash = await bcrypt.hash(secret, BCRYPT_SALT_ROUNDS);
    const saved = await this.repo.save(operator);

    return { operator: saved, apiKey };
  }

  private async findByIdOrThrow(id: string): Promise<PartnerOperator> {
    const operator = await this.repo.findOne({ where: { id } });
    if (!operator) {
      throw new NotFoundException(`Partner operator ${id} not found`);
    }
    return operator;
  }
}
