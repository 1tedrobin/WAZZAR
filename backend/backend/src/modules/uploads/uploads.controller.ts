import {
  BadRequestException,
  Controller,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UploadsService } from './uploads.service';

// Covers everything this app currently needs a photo/document for:
// rider onboarding docs (ID, license, vehicle registration, insurance)
// and proof-of-delivery photos. One generic endpoint rather than one
// per use case — the caller decides what the URL means (e.g. which
// DTO field it goes into), this endpoint just stores bytes and hands
// back a URL.
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

@ApiTags('Uploads')
@ApiBearerAuth('access-token')
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  // POST /uploads — any authenticated user (customer, rider, business,
  // admin). No role restriction: proof-of-delivery photos come from
  // riders, onboarding docs come from riders, but there's no reason to
  // lock this down further until a use case actually needs it.
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UploadsService.UPLOADS_DIR,
        filename: (_req, file, callback) => {
          const unique = randomUUID();
          callback(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          callback(new BadRequestException(`Unsupported file type: ${file.mimetype}`), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    if (!file) {
      throw new BadRequestException('No file uploaded — expected multipart field "file"');
    }
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    return {
      url: this.uploadsService.buildUrl(file.filename, requestOrigin),
      filename: file.filename,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    };
  }
}
