import { IsObject, IsString } from 'class-validator';

// Deliberately generic — Stripe event payloads vary by event `type`, so
// `data.object` is validated structurally by PaymentsService rather than
// with a ValidateNested DTO per event type. Covers payment_intent.succeeded,
// payment_intent.payment_failed, and charge.refunded per
// docs/delivery-notes/PAYMENTS_GOING_LIVE.md's "Event Types" list.
export class StripeWebhookDto {
  @IsString()
  type: string;

  @IsObject()
  data: { object: Record<string, unknown> };
}
