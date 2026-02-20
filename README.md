# GENLUXIMAGES.com MVP

Getty-style event/editorial image repository where photographers upload well-catalogued images and buyers can search, license, and check out through a shopping cart flow.

## Implemented in this MVP

- Searchable image catalog by keyword, event, and usage rights
- Event pages for gallery discovery
- Image detail pages with pricing and metadata
- Shopping cart flow (client-side local storage)
- Photographer upload form with naming-convention validation + DB persistence
- Checkout endpoint that creates license orders
- Server-side checkout pricing validation (client price tamper protection)
- Admin review queue to approve/reject pending uploads
- Attendee quick portal for event-first photo lookup
- Role-based login (`PHOTOGRAPHER`, `BUYER`, `ADMIN`)
- Private gallery + embargo controls with event unlock codes
- Order receipt pages + license receipt export + gated download links
- Stripe Checkout session flow with webhook-based payment confirmation
- Time-limited signed download URLs for protected asset delivery
- Full-resolution delivery providers (`direct` URL or `s3` presigned)
- Photographer upload automation (binary upload + metadata suggestions + watermarked previews)
- AI-assisted upload suggestions (hybrid cloud/fallback): title, event, location, tags, attendee keywords, caption draft
- Strict media filename validation for both images and videos, with auto-suggested rename hints
- Direct browser-to-cloud multipart upload for full-resolution files
- Drag-and-drop upload queue with thumbnail/status tracking
- Queue autopilot presets + optional auto-submit of catalog records
- Shared DB presets for photographer/editor collaboration
- Preset folders, team/personal scope, read-only approval, clone, and audit history
- Saved galleries for logged-in viewers (private, team, and share-link modes)
- Local browser-only saved picks for logged-out users, with post-login sync into a DB gallery
- Dedicated admin preset dashboard with filters and bulk moderation actions
- API endpoints:
  - `GET /api/images` for filtered catalog data
  - `POST /api/upload` for upload metadata and review queueing
  - `POST /api/upload/file` for binary upload automation and metadata extraction
  - `POST /api/upload/multipart/start` start cloud multipart upload
  - `POST /api/upload/multipart/sign-part` sign individual upload parts
  - `POST /api/upload/multipart/complete` finalize cloud multipart upload
  - `POST /api/upload/multipart/abort` abort failed multipart upload
  - `GET/POST /api/upload/presets` list/create/update shared presets
  - `POST /api/upload/presets/bulk` run bulk admin governance actions
  - `DELETE /api/upload/presets/:id` remove a preset
  - `POST /api/upload/presets/:id/clone` clone into personal editable preset
  - `GET /api/upload/presets/:id/history` view recent preset audit events
  - `GET/POST /api/galleries` list/create saved galleries
  - `GET/PATCH/DELETE /api/galleries/:id` manage gallery metadata
  - `POST /api/galleries/sync` import browser-local saved picks after login
  - `POST/DELETE /api/galleries/:id/items` add/remove saved image items
  - `POST/DELETE /api/galleries/:id/members` add/remove team collaborators
  - `POST/DELETE /api/galleries/:id/share` create/revoke share links
  - `GET /api/galleries/shared/:token` resolve a shared gallery token

## Branding logo

- Header logo path can be configured with:
  - `NEXT_PUBLIC_LOGO_PATH=/your-logo-file.ext`
- Default fallback path is `/genlux-logo.png`.
  - `POST /api/checkout` for creating paid license orders
  - `POST /api/payments/stripe/webhook` for Stripe payment callbacks
  - `GET /api/orders/:orderId` for authenticated order details
  - `GET /api/orders/:orderId/license` for downloadable receipt text
  - `GET /api/download/:imageId?order=:orderId` for authorized downloads

## Tech stack

- Next.js (App Router, TypeScript)
- Tailwind CSS
- Prisma ORM + SQLite (local development database)

## Local database setup

```bash
npm install
npm run db:push
npm run db:seed
npm run dev
```

This creates `dev.db` and seeds users + image assets.

## Admin review access

Set `ADMIN_REVIEW_KEY` in `.env`, then open:

`/admin/review?key=YOUR_ADMIN_REVIEW_KEY`

Pending uploads can be approved/published or rejected with review notes.

## Login and private gallery flow

- Sign in at `/login`
- Role checks:
  - Uploads: `PHOTOGRAPHER` or `ADMIN`
  - Checkout: `BUYER` or `ADMIN`
  - Review queue: `ADMIN` + `ADMIN_REVIEW_KEY`
- Unlock private event galleries at `/unlock?event=EVENT_SLUG`

## Payments and licensing

- `PAYMENT_PROVIDER=mock` is enabled by default for local testing.
- Stripe-ready path exists with environment placeholders:
  - `PAYMENT_PROVIDER=stripe`
  - `STRIPE_SECRET_KEY=...`
  - `STRIPE_WEBHOOK_SECRET=...`
  - `NEXT_PUBLIC_APP_URL=https://your-domain.com`
- Buyers can open `/orders/:id` after checkout to:
  - view licensed assets
  - download a receipt text file
  - access gated download links
- Signed download URLs expire after `DOWNLOAD_URL_TTL_SECONDS` (default 300s).
- Full-res delivery options:
  - `ASSET_DELIVERY_PROVIDER=direct` uses `fullResUrl` (or falls back to preview).
  - `ASSET_DELIVERY_PROVIDER=s3` uses presigned object URLs from `storageKey`.
  - Required S3 vars for presigned mode:
    - `S3_BUCKET_NAME`
    - `S3_REGION`
    - `S3_ACCESS_KEY_ID`
    - `S3_SECRET_ACCESS_KEY`
    - optional `S3_ENDPOINT` (for R2/MinIO)
    - optional `S3_FORCE_PATH_STYLE=true` (for MinIO/local stacks)
    - optional `S3_PUBLIC_BASE_URL` (if you want public URL fallback)
    - optional `S3_MULTIPART_PART_SIZE_MB` (default 8, minimum 5)

## Photographer automation flow

- Upload file first in `/upload` using the automation uploader.
- The system will:
  - store original image under local delivery path
  - generate a resized watermarked proof preview
  - auto-fill `filename`, `eventSlug`, `eventName`, `capturedAt`, and title suggestions
  - provide AI draft suggestions for location, tags, attendee keywords, and caption draft
  - populate `fullResUrl`, `previewUrl`, and `storageKey` fields
- For large files, use the multipart cloud button to upload full-resolution originals directly from browser to S3/R2.
- Multipart uploads run in parallel part workers for faster large-file transfers.
- Batch defaults let photographers set shared event/location/pricing once, then auto-submit the full queue.

### Optional AI provider settings (hybrid mode)

- `AI_UPLOAD_PROVIDER=fallback` (default local heuristics) or `openai`
- `AI_UPLOAD_MODEL=gpt-4.1-mini` (or another compatible model)
- `OPENAI_API_KEY=...` (required when `AI_UPLOAD_PROVIDER=openai`)

## Run locally

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`.

## SEO (Luxury LA/NY)

- Global metadata, Open Graph, Twitter cards, and JSON-LD are configured in:
  - `src/app/layout.tsx`
- Dynamic SEO metadata for key discovery pages:
  - `src/app/page.tsx`
  - `src/app/events/[slug]/page.tsx`
  - `src/app/images/[id]/page.tsx`
- Technical indexing assets:
  - `src/app/sitemap.ts`
  - `src/app/robots.ts`
- Luxury niche landing hubs:
  - `/luxury`
  - `/luxury/los-angeles/:vertical`
  - `/luxury/new-york/:vertical`

Set `NEXT_PUBLIC_APP_URL` in production so canonical and sitemap URLs are correct.

## Suggested next build phases

1. Add authentication and roles (`photographer`, `agency`, `admin`).
2. Upgrade SQLite to PostgreSQL (Neon/Supabase/RDS) for production scale.
3. Add real image uploads to cloud object storage (S3/R2).
4. Add branded payment UI + multi-currency support.
5. Generate branded PDF invoices and license certificates.
6. Build advanced search relevance and attendee face/bib matching (if needed).

## Recommended file naming convention

`YYYY-MM-DD_event-slug_subject_photographerinitials_sequence.jpg`

Example:
`2026-02-02_nova-fashion-week_redcarpet_ke_0102.jpg`
