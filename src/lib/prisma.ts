import { PrismaClient } from '../../lib/generated/prisma/client';

const IS_BUILD = process.env.VERCEL_ENV === "production" && process.env.NEXT_PHASE === "phase-production-build";

declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma = IS_BUILD ? ({} as PrismaClient) : (globalThis.prisma ?? new PrismaClient());

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

export default prisma;
