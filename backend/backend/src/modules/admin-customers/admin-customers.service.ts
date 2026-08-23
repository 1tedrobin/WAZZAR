import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Shipment, ShipmentStatus } from '../../database/entities/shipment.entity';
import { Role, UserRole } from '../../database/entities/user-role.entity';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';

export interface CustomerListItem {
  id: string;
  phone: string;
  email: string | null;
  fullName: string;
  status: string;
  verifiedAt: Date | null;
  createdAt: Date;
  shipmentCount: number;
}

export interface CustomerDetail extends CustomerListItem {
  completedShipmentCount: number;
  lastShipmentAt: Date | null;
}

const COMPLETED_STATUSES = [ShipmentStatus.DELIVERED, ShipmentStatus.COMPLETED];

// Same template as AdminBusinessesService (see that file's comments for
// the full reasoning on the query shape) — "Customers" is, by definition,
// every account holding the CUSTOMER role. The one real difference:
// customers have no profile/staff tables to join, so shipments (via the
// plain customer_id column on Shipment — see that entity's own NOTE
// about it not being a TypeORM relation) stand in as the per-account
// stat instead.
@Injectable()
export class AdminCustomersService {
  constructor(
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(Shipment)
    private readonly shipmentRepo: Repository<Shipment>,
  ) {}

  async list(query: ListCustomersQueryDto): Promise<{ customers: CustomerListItem[]; total: number }> {
    const qb = this.userRoleRepo
      .createQueryBuilder('ur')
      .leftJoinAndSelect('ur.user', 'user')
      .where('ur.role = :role', { role: Role.CUSTOMER });

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
    // AdminBusinessesService batching profile lookups for a page.
    const customerIds = rows.map((r) => r.userId);
    const counts = customerIds.length
      ? await this.shipmentRepo
          .createQueryBuilder('s')
          .select('s.customer_id', 'customerId')
          .addSelect('COUNT(*)', 'count')
          .where('s.customer_id IN (:...customerIds)', { customerIds })
          .groupBy('s.customer_id')
          .getRawMany<{ customerId: string; count: string }>()
      : [];
    const countByCustomerId = new Map(counts.map((c) => [c.customerId, Number(c.count)]));

    return {
      customers: rows.map((ur) => this.toListItem(ur, countByCustomerId.get(ur.userId) ?? 0)),
      total,
    };
  }

  async detail(id: string): Promise<CustomerDetail> {
    const ur = await this.userRoleRepo.findOne({
      where: { userId: id, role: Role.CUSTOMER },
      relations: ['user'],
    });
    if (!ur) throw new NotFoundException('Customer account not found');

    const [shipmentCount, completedShipmentCount, lastShipment] = await Promise.all([
      this.shipmentRepo.count({ where: { customerId: id } }),
      this.shipmentRepo.count({ where: { customerId: id, status: In(COMPLETED_STATUSES) } }),
      this.shipmentRepo.findOne({ where: { customerId: id }, order: { createdAt: 'DESC' } }),
    ]);

    return {
      ...this.toListItem(ur, shipmentCount),
      completedShipmentCount,
      lastShipmentAt: lastShipment?.createdAt ?? null,
    };
  }

  private toListItem(ur: UserRole, shipmentCount: number): CustomerListItem {
    return {
      id: ur.userId,
      phone: ur.user.phone,
      email: ur.user.email,
      fullName: ur.user.fullName,
      status: ur.user.status,
      verifiedAt: ur.verifiedAt,
      createdAt: ur.user.createdAt,
      shipmentCount,
    };
  }
}
