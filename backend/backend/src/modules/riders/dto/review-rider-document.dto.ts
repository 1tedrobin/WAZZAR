import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DocumentReviewStatus } from '../../../database/entities/rider.entity';

// PENDING is deliberately not an allowed value here — it's the implicit
// starting state for a document with no review entry yet (see
// Rider.documentReviews), not something an admin sets explicitly. Only
// APPROVED/REJECTED are real decisions.
export class ReviewRiderDocumentDto {
  @IsIn([DocumentReviewStatus.APPROVED, DocumentReviewStatus.REJECTED])
  status: DocumentReviewStatus.APPROVED | DocumentReviewStatus.REJECTED;

  // Required when status is REJECTED (checked in RidersService.reviewDocument,
  // not here, since it depends on another field) — the rider needs to know
  // what to fix and resubmit. Ignored when approving.
  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;
}
