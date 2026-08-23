import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessCustomer } from '../../database/entities/business-customer.entity';
import { CreateBusinessCustomerDto } from './dto/create-business-customer.dto';
import { UpdateBusinessCustomerDto } from './dto/update-business-customer.dto';

@Injectable()
export class BusinessCustomersService {
  constructor(
    @InjectRepository(BusinessCustomer)
    private readonly repo: Repository<BusinessCustomer>,
  ) {}

  async create(businessId: string, dto: CreateBusinessCustomerDto): Promise<BusinessCustomer> {
    const entry = this.repo.create({
      businessId,
      name: dto.name,
      phone: dto.phone,
      address: dto.address,
      notes: dto.notes ?? null,
    });
    return this.repo.save(entry);
  }

  // Newest-first — matches the mock data's implicit ordering and is
  // what a business owner scanning their own list expects to see.
  async list(businessId: string): Promise<BusinessCustomer[]> {
    return this.repo.find({ where: { businessId }, order: { createdAt: 'DESC' } });
  }

  async update(
    businessId: string,
    id: string,
    dto: UpdateBusinessCustomerDto,
  ): Promise<BusinessCustomer> {
    const entry = await this.findOwnedOrThrow(businessId, id);

    if (dto.name !== undefined) entry.name = dto.name;
    if (dto.phone !== undefined) entry.phone = dto.phone;
    if (dto.address !== undefined) entry.address = dto.address;
    if (dto.notes !== undefined) entry.notes = dto.notes;

    return this.repo.save(entry);
  }

  async remove(businessId: string, id: string): Promise<{ deleted: true }> {
    await this.findOwnedOrThrow(businessId, id);
    await this.repo.delete({ id });
    return { deleted: true };
  }

  // Not just findOne(id) — a business must never be able to read,
  // edit, or delete another business's address book by guessing a
  // UUID, so ownership is checked as part of the lookup itself, not as
  // an afterthought once the row is already in hand.
  private async findOwnedOrThrow(businessId: string, id: string): Promise<BusinessCustomer> {
    const entry = await this.repo.findOne({ where: { id } });
    if (!entry) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    if (entry.businessId !== businessId) {
      throw new ForbiddenException('You do not have access to this customer');
    }
    return entry;
  }
}
