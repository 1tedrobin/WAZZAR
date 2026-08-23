import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BusinessStaff,
  BusinessStaffRole,
  BusinessStaffStatus,
} from '../../database/entities/business-staff.entity';
import { CreateBusinessStaffDto } from './dto/create-business-staff.dto';
import { UpdateBusinessStaffDto } from './dto/update-business-staff.dto';

@Injectable()
export class BusinessStaffService {
  constructor(
    @InjectRepository(BusinessStaff)
    private readonly repo: Repository<BusinessStaff>,
  ) {}

  // "Invite" always lands as PENDING — there is deliberately no code
  // path that creates an ACTIVE entry directly. This is a roster, not a
  // real invite system (see the migration's comment) — no email is
  // actually sent, so nobody has actually "accepted" anything yet.
  // Flipping PENDING -> ACTIVE is exposed via update() below purely as
  // a manual admin action, not something this "invite" call implies.
  async create(businessId: string, dto: CreateBusinessStaffDto): Promise<BusinessStaff> {
    const entry = this.repo.create({
      businessId,
      name: dto.name,
      email: dto.email,
      role: dto.role ?? BusinessStaffRole.STAFF,
      status: BusinessStaffStatus.PENDING,
    });
    return this.repo.save(entry);
  }

  async list(businessId: string): Promise<BusinessStaff[]> {
    return this.repo.find({ where: { businessId }, order: { createdAt: 'DESC' } });
  }

  async update(
    businessId: string,
    id: string,
    dto: UpdateBusinessStaffDto,
  ): Promise<BusinessStaff> {
    const entry = await this.findOwnedOrThrow(businessId, id);

    if (dto.name !== undefined) entry.name = dto.name;
    if (dto.email !== undefined) entry.email = dto.email;
    if (dto.role !== undefined) entry.role = dto.role;
    if (dto.status !== undefined) entry.status = dto.status;

    return this.repo.save(entry);
  }

  async remove(businessId: string, id: string): Promise<{ deleted: true }> {
    await this.findOwnedOrThrow(businessId, id);
    await this.repo.delete({ id });
    return { deleted: true };
  }

  private async findOwnedOrThrow(businessId: string, id: string): Promise<BusinessStaff> {
    const entry = await this.repo.findOne({ where: { id } });
    if (!entry) {
      throw new NotFoundException(`Staff member ${id} not found`);
    }
    if (entry.businessId !== businessId) {
      throw new ForbiddenException('You do not have access to this staff member');
    }
    return entry;
  }
}
