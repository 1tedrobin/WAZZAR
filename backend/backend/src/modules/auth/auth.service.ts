import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { Role, UserRole } from '../../database/entities/user-role.entity';
import { JwtPayload } from './jwt-payload.interface';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const BCRYPT_SALT_ROUNDS = 10;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends AuthTokens {
  user: {
    id: string;
    phone: string;
    email: string | null;
    fullName: string;
    roles: Role[];
  };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(UserRole)
    private readonly userRolesRepo: Repository<UserRole>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.usersRepo.findOne({
      where: [{ phone: dto.phone }, ...(dto.email ? [{ email: dto.email }] : [])],
    });

    if (existing) {
      throw new ConflictException(
        existing.phone === dto.phone
          ? 'An account with this phone number already exists'
          : 'An account with this email already exists',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);

    const user = await this.usersRepo.save(
      this.usersRepo.create({
        phone: dto.phone,
        email: dto.email ?? null,
        passwordHash,
        fullName: dto.fullName,
      }),
    );

    const userRole = await this.userRolesRepo.save(
      this.userRolesRepo.create({ userId: user.id, role: dto.role }),
    );

    return this.buildAuthResult(user, [userRole.role]);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.usersRepo.findOne({ where: { phone: dto.phone } });

    // Same error for "no such user" and "wrong password" — don't leak
    // which one it was.
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid phone or password');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('This account is not active');
    }

    const roles = await this.getRolesForUser(user.id);
    return this.buildAuthResult(user, roles);
  }

  // TODO: refresh tokens aren't persisted/blacklisted anywhere yet, so
  // logout and "sign out of all devices" (both in
  // WAZZAR_SYSTEM_ARCHITECTURE.md's Session Management section) can't be
  // implemented — a still-valid refresh token can't be revoked early.
  // Needs a `refresh_tokens` table (or a Redis set) keyed by user id
  // before that's possible.
  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersRepo.findOne({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const roles = await this.getRolesForUser(user.id);
    return this.signTokens(user, roles);
  }

  async getCurrentUser(userId: string): Promise<AuthResult['user']> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    const roles = await this.getRolesForUser(user.id);
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      fullName: user.fullName,
      roles,
    };
  }

  private async getRolesForUser(userId: string): Promise<Role[]> {
    const rows = await this.userRolesRepo.find({ where: { userId } });
    return rows.map((row) => row.role);
  }

  private async buildAuthResult(user: User, roles: Role[]): Promise<AuthResult> {
    const tokens = await this.signTokens(user, roles);
    return {
      ...tokens,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        fullName: user.fullName,
        roles,
      },
    };
  }

  private async signTokens(user: User, roles: Role[]): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: user.id, phone: user.phone, roles };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: Number(this.configService.get('JWT_EXPIRY_SECONDS', 900)),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: Number(
          this.configService.get('JWT_REFRESH_EXPIRY_SECONDS', 604800),
        ),
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
