import "server-only";
import { PrismaClient } from "@prisma/client";

// Reaproveita o client entre recarregamentos do Next em desenvolvimento.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
