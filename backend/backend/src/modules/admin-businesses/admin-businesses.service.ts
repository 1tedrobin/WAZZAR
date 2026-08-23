import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BusinessCustomer } from '../../database/entities/business-customer.entity';
import { BusinessProfile } from '../../database/entities/business-profile.entity';
import { BusinessStaff } from '../../database/entities/business-staff.entity';
import { Role, UserRole } from '../../database/entities/user-role.entity';
import { ListBusinessesQueryDto } from './dto/list-businesses-query.dto';

export interface BusinessListItem {
  id: string;
  phone: string;
  email: string | null;
  fullName: string;
  status: string;
  verifiedAt: Date | null;
  createdAt: Date;
  businessName: string | null;
  category: string | null;
}

export interface BusinessDetail extends BusinessListItem {
  profile: BusinessProfile | null;
  staffCount: number;
  customerCount: number;
}

@Injectable()
export class AdminBusinessesService {
  constructor(
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(BusinessProfile)
    private readonly profileRepo: Repository<BusinessProfile>,
    @InjectRepository(BusinessStaff)
    private readonly staffRepo: Repository<BusinessStaff>,
    @InjectRepository(BusinessCustomer)
    private readonly businessCustomerRepo: Repository<BusinessCustomer>,
  ) {}

  // The one place in the backend that needs a real join + filter +
  // paginate query across users/user_roles (see AuthService — every
  // other module here gets by with plain repo.find()). "Businesses" is,
  // by definition, every account holding the BUSINESS role — there's no
  // separate businesses table, same as riders being users with a RIDER
  // role plus a riders row.
  async list(query: ListBusinessesQueryDto): Promise<{ businesses: BusinessListItem[]; total: number }> {
    const qb = this.userRoleRepo
      .createQueryBuilder('ur')
      .leftJoinAndSelect('ur.user', 'user')
      .where('ur.role = :role', { role: Role.BUSINESS });

    if (query.search) {
      qb.andWhere(
        '(user.fullName ILIKE :search OR user.phone ILIKE :search OR user.email ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }
    if (query.status) {
      qb.andWhere('user.status = :status', { status: query.status });
    }

    qb.orderBy('user.createdAt', 'DESC').take(query.limit).skip(query.offset);

    const [rows, total] = await qb.getManyAndCount();

    // Batch-fetched rather than N+1'd per row — same reasoning as
    // ShipmentsService batching rider lookups for a dispatch queue page.
    const businessIds = rows.map((r) => r.userId);
    const profiles = businessIds.length
      ? await this.profileRepo.find({ where: { businessId: In(businessIds) } })
      : [];
    const profileByBusinessId = new Map(profiles.map((p) => [p.businessId, p]));

    return {
      businesses: rows.map((ur) => this.toListItem(ur, profileByBusinessId.get(ur.userId) ?? null)),
      total,
    };
  }

  async detail(id: string): Promise<BusinessDetail> {
    const ur = await this.userRoleRepo.findOne({
      where: { userId: id, role: Role.BUSINESS },
      relations: ['user'],
    });
    if (!ur) throw new NotFoundException('Business account not found');

    const [profile, staffCount, customerCount] = await Promise.all([
      this.profileRepo.findOne({ where: { businessId: id } }),
      this.staffRepo.count({ where: { businessId: id } }),
      this.businessCustomerRepo.count({ where: { businessId: id } }),
    ]);

    return {
      ...this.toListItem(ur, profile),
      profile: profile ?? null,
      staffCount,
      customerCount,
    };
  }

  private toListItem(ur: UserRole, profile: BusinessProfile | null): BusinessListItem {
    return {
      id: ur.userId,
      phone: ur.user.phone,
      email: ur.user.email,
      fullName: ur.user.fullName,
      status: ur.user.status,
      verifiedAt: ur.verifiedAt,
      createdAt: ur.user.createdAt,
      businessName: profile?.businessName ?? null,
      category: profile?.category ?? null,
    };
  }
}
