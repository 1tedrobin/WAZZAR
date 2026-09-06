import { BadRequestException, Controller, Get, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { Role } from '../../database/entities/user-role.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { buildCsvTemplate, BulkShipmentsService } from './bulk-shipments.service';

const MAX_CSV_SIZE_BYTES = 2 * 1024 * 1024; // 2MB — generous for a 100-row (MAX_BULK_ROWS) address list.

@ApiTags('Business — Bulk Shipments')
@ApiBearerAuth('access-token')
@Controller('business/bulk-shipments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BUSINESS)
export class BulkShipmentsController {
  constructor(private readonly bulkShipmentsService: BulkShipmentsService) {}

  // GET /business/bulk-shipments/template — a starting-point CSV a
  // business can open in a spreadsheet tool and fill in.
  @Get('template')
  downloadTemplate(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="wazzar-bulk-shipments-template.csv"');
    res.send(buildCsvTemplate());
  }

  // POST /business/bulk-shipments — multipart upload, field name
  // "file". Uses memoryStorage (not UploadsService's diskStorage) —
  // unlike proof-of-delivery photos or onboarding docs, this CSV has
  // no lasting purpose once parsed; nothing here needs a durable URL.
  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_CSV_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!file.originalname.toLowerCase().endsWith('.csv')) {
          callback(new BadRequestException('Expected a .csv file'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async importCsv(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: JwtPayload) {
    if (!file) {
      throw new BadRequestException('No file uploaded — expected multipart field "file"');
    }
    return this.bulkShipmentsService.importCsv(user.sub, file.buffer);
  }
}
