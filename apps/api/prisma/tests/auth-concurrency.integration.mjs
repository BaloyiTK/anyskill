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

test("refresh-token rotation is single-use and family revocation invalidates descendants", async () => {
  const user = await prisma.user.create({
    data: {
      email: `refresh-family-${suffix}@example.invalid`,
      passwordHash: "integration-test-only-not-a-real-password-hash",
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  const familyId = randomUUID();
  const oldSession = await prisma.refreshSession.create({
    data: {
      userId: user.id, tokenHash: `old-${suffix}`, tokenFamilyId: familyId,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const childSession = await prisma.refreshSession.create({
    data: {
      userId: user.id, tokenHash: `child-${suffix}`, tokenFamilyId: familyId,
      expiresAt: new Date(Date.now() + 60000),
    },
  });

  const rotate = () => prisma.refreshSession.updateMany({
    where: { id: oldSession.id, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { revokedAt: new Date() },
  });
  const rotations = await Promise.all([rotate(), rotate()]);
  assert.deepEqual(rotations.map((result) => result.count).sort(), [0, 1]);

  const revokeFamily = await prisma.refreshSession.updateMany({
    where: { tokenFamilyId: familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  assert.equal(revokeFamily.count, 1);
  const child = await prisma.refreshSession.findUnique({ where: { id: childSession.id } });
  assert.ok(child?.revokedAt);

  await prisma.refreshSession.deleteMany({ where: { tokenFamilyId: familyId } });
  await prisma.user.delete({ where: { id: user.id } });
});

test("concurrent identity submissions create only one pending case and notification", async () => {
  const user = await prisma.user.create({
    data: {
      email: `identity-submit-race-${suffix}@example.invalid`,
      passwordHash: "integration-test-only-not-a-real-password-hash",
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });

  const submit = () => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('identity-verification-submit'), hashtext(${user.id}))`;
    const existing = await tx.identityVerificationCase.findFirst({
      where: { userId: user.id, status: { in: ["SUBMITTED", "UNDER_REVIEW", "NEEDS_INFORMATION"] } },
      select: { id: true },
    });
    if (existing) return false;
    const created = await tx.identityVerificationCase.create({
      data: { userId: user.id, status: "SUBMITTED", provider: "MANUAL_REVIEW" },
      select: { id: true },
    });
    await tx.user.update({ where: { id: user.id }, data: { identityVerification: "PENDING" } });
    await tx.appNotification.create({
      data: { userId: user.id, title: "Profile submitted", body: "Identity review submitted." },
    });
    return Boolean(created.id);
  });

  const results = await Promise.all([submit(), submit(), submit(), submit()]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await prisma.identityVerificationCase.count({ where: { userId: user.id } }), 1);
  assert.equal(await prisma.appNotification.count({ where: { userId: user.id, title: "Profile submitted" } }), 1);
  await prisma.user.delete({ where: { id: user.id } });
});

test("account cleanup removes registered push tokens and queued private notifications", async () => {
  const user = await prisma.user.create({
    data: {
      email: `push-cleanup-${suffix}@example.invalid`,
      passwordHash: "integration-test-only-not-a-real-password-hash",
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  const token = `ExponentPushToken[${randomUUID()}]`;
  await prisma.pushDevice.create({
    data: { userId: user.id, expoPushToken: token, platform: "android" },
  });
  await prisma.appNotification.create({
    data: { userId: user.id, title: "Private test notification", body: "Must not be delivered after account deletion." },
  });

  await prisma.$transaction(async (tx) => {
    await tx.pushDevice.deleteMany({ where: { userId: user.id } });
    await tx.appNotification.deleteMany({ where: { userId: user.id } });
    await tx.refreshSession.deleteMany({ where: { userId: user.id } });
    await tx.user.delete({ where: { id: user.id } });
  });

  assert.equal(await prisma.pushDevice.count({ where: { expoPushToken: token } }), 0);
  assert.equal(await prisma.appNotification.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.user.count({ where: { id: user.id } }), 0);
});
