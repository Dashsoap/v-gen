# V-Gen Project

## Tech Stack
- Next.js 15 + TypeScript + Tailwind CSS v4
- Prisma + MySQL + Redis + BullMQ + FFmpeg
- NextAuth for authentication
- Docker deployment

## Key Directories
- `src/app/[locale]/` — Pages (i18n: zh/en)
- `src/app/api/` — API routes
- `src/lib/generators/` — Image/Video/Audio generators
- `src/lib/workers/` — BullMQ task handlers
- `src/lib/compose/` — FFmpeg video composition
- `prisma/schema.prisma` — Database schema
