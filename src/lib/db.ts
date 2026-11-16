import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'], // не логируем SQL: в параметрах личные данные (анкета, резюме)
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db