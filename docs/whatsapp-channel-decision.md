# WhatsApp channel decision — 28 Aug 2026

## Decision
Use **Meta WhatsApp Cloud API directly** as the preferred production path for Lead2Job, with the existing provider-neutral `channel-inbound` adapter kept as the internal boundary.

Twilio remains a fallback if Meta onboarding becomes materially harder for pilot customers.

## Why
- Lead2Job already owns the AI receptionist, conversation state, lead creation, follow-up and owner workflow. A second messaging abstraction is not required for the core product.
- Direct Meta avoids an extra provider handling fee on every inbound/outbound WhatsApp message.
- Twilio currently charges $0.005 per WhatsApp message in addition to Meta fees. It is useful as a fallback because onboarding and multi-channel APIs are simpler.
- Current pricing is changing again on 1 Oct 2026, so pricing must be rechecked before commercial launch.
- Existing WhatsApp Business App numbers may have a coexistence onboarding path when eligible. Eligibility must be checked during real onboarding; do not migrate/delete an existing app account blindly.

## Architecture
Meta webhook -> `whatsapp-meta` provider adapter -> `channel-inbound` -> `receive-customer-message` -> conversations/leads/follow-ups -> owner UI.

Outbound AI reply: `receive-customer-message` result -> Meta provider adapter -> WhatsApp Cloud API.

The provider adapter must:
1. Verify Meta webhook challenge and webhook authenticity.
2. Parse only supported WhatsApp text events initially.
3. Use Meta message ID as `provider_message_id` for idempotency.
4. Map Meta phone-number ID to a Lead2Job `channel_connections` record.
5. Forward normalized inbound content into the existing channel adapter/core.
6. Send the safe server-approved reply returned by the AI core.
7. Never log access tokens, app secrets, webhook secrets, or full message payloads unnecessarily.
8. Treat media/voice/status callbacks as unsupported until explicitly implemented.

## Onboarding gate
Do not activate a real number until the owner explicitly approves the external Meta setup and supplies/authorizes the number. Before changing an existing WhatsApp Business App number, check whether Meta coexistence is available for that account/number.

## Pilot fallback
The public customer link remains the zero-cost pilot channel and must continue working independently of WhatsApp.
