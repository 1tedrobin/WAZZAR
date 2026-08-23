import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Local-disk storage — the MVP choice from MASTER_GAPS_AND_ROADMAP.md
// ("File/photo upload endpoint"). This is the one place that
// knows *where* files live; swapping to S3-compatible storage later
// means changing this file (and the multer storage engine in
// uploads.controller.ts) and nothing else — callers only ever see the
// URL this service hands back, never a filesystem path.
@Injectable()
export class UploadsService {
  // Configurable so a deploy can point this at a mounted volume; the
  // default matches what main.ts serves statically at /uploads.
  static readonly UPLOADS_DIR = process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');

  constructor() {
    if (!existsSync(UploadsService.UPLOADS_DIR)) {
      mkdirSync(UploadsService.UPLOADS_DIR, { recursive: true });
    }
  }

  // PUBLIC_BASE_URL lets a deploy behind a real domain/CDN return an
  // absolute URL instead of one derived from the request. Falls back to
  // deriving protocol+host from the request itself so the URL is always
  // absolute even when unset — SubmitProofOfDeliveryDto.photoUrl (and
  // any future consumer) validates with @IsUrl(), which rejects a bare
  // relative path like "/uploads/x.jpg".
  buildUrl(filename: string, requestOrigin: string): string {
    const base = process.env.PUBLIC_BASE_URL || requestOrigin;
    return `${base}/uploads/${filename}`;
  }
}
