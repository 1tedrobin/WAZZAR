import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hub } from '../../database/entities/hub.entity';
import { HubAssignment } from '../../database/entities/hub-assignment.entity';
import { Role, UserRole } from '../../database/entities/user-role.entity';
import { AssignHubStaffDto } from './dto/assign-hub-staff.dto';
import { CreateHubDto } from './dto/create-hub.dto';
import { UpdateHubDto } from './dto/update-hub.dto';

@Injectable()
export class HubsService {
  constructor(
    @InjectRepository(Hub)
    private readonly hubsRepo: Repository<Hub>,
    @InjectRepository(HubAssignment)
    private readonly hubAssignmentsRepo: Repository<HubAssignment>,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
  ) {}

  async create(dto: CreateHubDto): Promise<Hub> {
    const hub = this.hubsRepo.create({
      name: dto.name,
      city: dto.city,
      latitude: dto.latitude.toString(),
      longitude: dto.longitude.toString(),
      address: dto.address,
      capacityKg: dto.capacityKg ?? null,
      managerId: dto.managerId ?? null,
    });
    return this.hubsRepo.save(hub);
  }

  // Optional city filter — the one real query LegsService.planIntercityShipment
  // and the (future) dispatcher app both need: "which hub(s) serve this city".
  async list(city?: string): Promise<Hub[]> {
    return this.hubsRepo.find({
      where: city ? { city } : {},
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Hub> {
    return this.findByIdOrThrow(id);
  }

  async update(id: string, dto: UpdateHubDto): Promise<Hub> {
    const hub = await this.findByIdOrThrow(id);

    if (dto.name !== undefined) hub.name = dto.name;
    if (dto.city !== undefined) hub.city = dto.city;
    if (dto.latitude !== undefined) hub.latitude = dto.latitude.toString();
    if (dto.longitude !== undefined) hub.longitude = dto.longitude.toString();
    if (dto.address !== undefined) hub.address = dto.address;
    if (dto.capacityKg !== undefined) hub.capacityKg = dto.capacityKg;
    if (dto.managerId !== undefined) hub.managerId = dto.managerId;
    if (dto.isActive !== undefined) hub.isActive = dto.isActive;

    return this.hubsRepo.save(hub);
  }

  // Assigns a DISPATCHER-role user to operate this hub — backs the
  // (future) dispatcher app's "which hub am I working" scoping and
  // LegsService.getPendingQueue's per-dispatcher filtering. Requires the
  // target user to already hold Role.DISPATCHER (granted out-of-band by
  // an admin, same as every other privileged role in this codebase —
  // see user-role.entity.ts) — assigning a hub to a customer/rider
  // account by mistake would silently do nothing useful downstream, so
  // it's rejected here instead.
  async assignStaff(hubId: string, dto: AssignHubStaffDto): Promise<HubAssignment> {
    await this.findByIdOrThrow(hubId);

    const hasDispatcherRole = await this.userRoleRepo.findOne({
      where: { userId: dto.userId, role: Role.DISPATCHER },
    });
    if (!hasDispatcherRole) {
      throw new BadRequestException(
        'User must already hold the DISPATCHER role before being assigned to a hub',
      );
    }

    const existing = await this.hubAssignmentsRepo.findOne({
      where: { hubId, userId: dto.userId },
    });
    if (existing) {
      throw new ConflictException('This user is already assigned to this hub');
    }

    const assignment = this.hubAssignmentsRepo.create({ hubId, userId: dto.userId });
    return this.hubAssignmentsRepo.save(assignment);
  }

  async listStaff(hubId: string): Promise<HubAssignment[]> {
    await this.findByIdOrThrow(hubId);
    return this.hubAssignmentsRepo.find({ where: { hubId }, order: { assignedAt: 'ASC' } });
  }

  async removeStaff(hubId: string, userId: string): Promise<{ removed: true }> {
    const assignment = await this.hubAssignmentsRepo.findOne({ where: { hubId, userId } });
    if (!assignment) {
      throw new NotFoundException('This user is not assigned to this hub');
    }
    await this.hubAssignmentsRepo.delete({ id: assignment.id });
    return { removed: true };
  }

  // Used by LegsController/LegsService to scope a DISPATCHER's view of
  // the pending-legs queue to only the hub(s) they're assigned to. An
  // ADMIN/SUPER_ADMIN caller bypasses this entirely (sees every hub) —
  // see LegsService.getPendingQueue.
  async findAssignedHubIds(userId: string): Promise<string[]> {
    const assignments = await this.hubAssignmentsRepo.find({ where: { userId } });
    return assignments.map((a) => a.hubId);
  }

  private async findByIdOrThrow(id: string): Promise<Hub> {
    const hub = await this.hubsRepo.findOne({ where: { id } });
    if (!hub) {
      throw new NotFoundException(`Hub ${id} not found`);
    }
    return hub;
  }
}
