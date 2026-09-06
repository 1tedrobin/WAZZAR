import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Carrier, CarrierStatus } from '../../database/entities/carrier.entity';
import { PartnerOperatorsService } from '../partner-operators/partner-operators.service';
import { CreateCarrierDto } from './dto/create-carrier.dto';
import { UpdateCarrierDto } from './dto/update-carrier.dto';

@Injectable()
export class CarriersService {
  constructor(
    @InjectRepository(Carrier)
    private readonly repo: Repository<Carrier>,
    // Only used to validate a create() call's partnerOperatorId actually
    // exists — a carrier orphaned under a typo'd/deleted operator id
    // would silently never show up in that operator's fleet anywhere.
    private readonly partnerOperatorsService: PartnerOperatorsService,
  ) {}

  async create(dto: CreateCarrierDto): Promise<Carrier> {
    await this.partnerOperatorsService.findOne(dto.partnerOperatorId);

    const carrier = this.repo.create({
      partnerOperatorId: dto.partnerOperatorId,
      vehicleType: dto.vehicleType,
      registration: dto.registration,
      capacityKg: dto.capacityKg ?? null,
      routes: dto.routes ?? [],
      schedule: dto.schedule ?? null,
    });
    return this.repo.save(carrier);
  }

  async list(partnerOperatorId?: string): Promise<Carrier[]> {
    return this.repo.find({
      where: partnerOperatorId ? { partnerOperatorId } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Carrier> {
    return this.findByIdOrThrow(id);
  }

  async update(id: string, dto: UpdateCarrierDto): Promise<Carrier> {
    const carrier = await this.findByIdOrThrow(id);

    if (dto.vehicleType !== undefined) carrier.vehicleType = dto.vehicleType;
    if (dto.registration !== undefined) carrier.registration = dto.registration;
    if (dto.capacityKg !== undefined) carrier.capacityKg = dto.capacityKg;
    if (dto.routes !== undefined) carrier.routes = dto.routes;
    if (dto.schedule !== undefined) carrier.schedule = dto.schedule;
    if (dto.status !== undefined) carrier.status = dto.status;

    return this.repo.save(carrier);
  }

  // Shortlist for a TRUNK leg between two cities — used by
  // LegsService.getCarrierCandidates. Deliberately simple (route match +
  // ACTIVE status only, no ranking/scheduling logic yet, unlike
  // DispatchService's rider candidate ranking) — a real routing/schedule
  // match against `schedule` JSONB is flagged as a follow-up in
  // PHASE2_INTERCITY_FOUNDATION.md, not built here.
  async findActiveForRoute(fromCity: string, toCity: string): Promise<Carrier[]> {
    const active = await this.repo.find({ where: { status: CarrierStatus.ACTIVE } });
    return active.filter((carrier) =>
      carrier.routes.some(
        (route) => route.fromCity === fromCity && route.toCity === toCity,
      ),
    );
  }

  private async findByIdOrThrow(id: string): Promise<Carrier> {
    const carrier = await this.repo.findOne({ where: { id } });
    if (!carrier) {
      throw new NotFoundException(`Carrier ${id} not found`);
    }
    return carrier;
  }
}
