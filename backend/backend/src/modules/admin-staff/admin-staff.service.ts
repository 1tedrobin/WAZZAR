import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { In, Repository } from 'typeorm';
import { User, UserStatus } from '../../database/entities/user.entity';
import { Role, UserRole } from '../../database/entities/user-role.entity';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';

const BCRYPT_SALT_ROUNDS = 10;

const STAFF_ROLES = [Role.DISPATCHER, Role.ADMIN, Role.SUPER_ADMIN];

export interface StaffMember {
  userId: string;
  phone: string;
  fullName: string;
  status: UserStatus;
  roles: Role[];
}

@Injectable()
export class AdminStaffService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(UserRole)
    private readonly userRolesRepo: Repository<UserRole>,
  ) {}

  async listStaff(): Promise<StaffMember[]> {
    const staffRoles = await this.userRolesRepo.find({
      where: { role: In(STAFF_ROLES) },
      relations: ['user'],
    });

    const byUserId = new Map<string, StaffMember>();
    for (const { user, role } of staffRoles) {
      if (!user) continue;

      const existing = byUserId.get(user.id);
      if (existing) {
        existing.roles.push(role);
      } else {
        byUserId.set(user.id, {
          userId: user.id,
          phone: user.phone,
          fullName: user.fullName,
          status: user.status,
          roles: [role],
        });
      }
    }

    return Array.from(byUserId.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async createOrPromote(dto: CreateStaffUserDto, grantedBy: string): Promise<StaffMember> {
    let user = await this.usersRepo.findOne({ where: { phone: dto.phone } });

    if (!user) {
      if (!dto.password) {
        throw new BadRequestException(
          `No user exists with phone ${dto.phone} — password is required to create a new staff account`,
        );
      }
      const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);
      user = this.usersRepo.create({
        phone: dto.phone,
        fullName: dto.fullName || 'Staff',
        passwordHash,
        status: UserStatus.ACTIVE,
      });
      user = await this.usersRepo.save(user);
    }

    const existingRole = await this.userRolesRepo.findOne({
      where: { userId: user.id, role: dto.role },
    });

    if (!existingRole) {
      const userRole = this.userRolesRepo.create({
        userId: user.id,
        role: dto.role,
        verifiedAt: new Date(),
      });
      await this.userRolesRepo.save(userRole);
      void grantedBy;
    }

    const roles = await this.userRolesRepo.find({ where: { userId: user.id, role: In(STAFF_ROLES) } });

    return {
      userId: user.id,
      phone: user.phone,
      fullName: user.fullName,
      status: user.status,
      roles: roles.map((r) => r.role),
    };
  }

  async revokeRole(userId: string, role: Role): Promise<void> {
    if (!STAFF_ROLES.includes(role)) {
      throw new BadRequestException(
        `role must be one of ${STAFF_ROLES.join(', ')} — use the normal user management flow for other roles`,
      );
    }

    const existing = await this.userRolesRepo.findOne({ where: { userId, role } });
    if (!existing) {
      throw new NotFoundException(`User ${userId} does not have role ${role}`);
    }

    if (role === Role.SUPER_ADMIN) {
      const remaining = await this.userRolesRepo.count({ where: { role: Role.SUPER_ADMIN } });
      if (remaining <= 1) {
        throw new ConflictException(
          'Cannot revoke the last remaining SUPER_ADMIN — promote another user to SUPER_ADMIN first',
        );
      }
    }

    await this.userRolesRepo.remove(existing);
  }
}