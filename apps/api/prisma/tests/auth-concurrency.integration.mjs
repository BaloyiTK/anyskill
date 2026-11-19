import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const suffix = randomUUID();
const registrationEmail = `auth-race-${suffix}@example.invalid`;
const pendingEmail = `otp-race-${suffix}@example.invalid`;
let pendingId;

before(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must point to a disposable test database.");
  await prisma.$connect();
});

after(async () => {
  if (pendingId) await prisma.pendingRegistration.deleteMany({ where: { id: pendingId } });
  await prisma.user.deleteMany({ where: { email: registrationEmail } });
  await prisma.$disconnect();
});

test("only one concurrent verification can atomically consume a registration OTP", async () => {
  const now = new Date();
  const pending = await prisma.pendingRegistration.create({
    data: {
      email: pendingEmail, mode: "SEEKER", otpHash: "a".repeat(64),
      expiresAt: new Date(now.getTime() + 600000),
      resendAvailableAt: new Date(now.getTime() + 60000),
    },
    select: { id: true },
  });
  pendingId = pending.id;
  const consume = () => prisma.pendingRegistration.updateMany({
    where: { id: pending.id, verifiedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } },
    data: { verifiedAt: now },
  });
  const results = await Promise.all([consume(), consume()]);
  assert.deepEqual(results.map((result) => result.count).sort(), [0, 1]);
  assert.ok((await prisma.pendingRegistration.findUnique({ where: { id: pending.id } }))?.verifiedAt);
});

test("only one concurrent registration insert can create a user for the same email", async () => {
  const create = () => prisma.user.create({
    data: { email: registrationEmail, passwordHash: "integration-test-only-not-a-real-password-hash", emailVerifiedAt: new Date() },
    select: { id: true },
  });
  const results = await Promise.allSettled([create(), create()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.equal(rejected.reason?.code, "P2002");
  assert.equal(await prisma.user.count({ where: { email: registrationEmail } }), 1);
});
