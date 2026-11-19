import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const fixtures = [];

before(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must point to a disposable test database.");
  await prisma.$connect();
});

after(async () => {
  for (const fixture of fixtures) {
    if (fixture.requestId) await prisma.serviceRequest.deleteMany({ where: { id: fixture.requestId } });
    if (fixture.userIds.length) await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
  }
  await prisma.$disconnect();
});

async function createFixture(providerCount = 2) {
  const suffix = randomUUID();
  const seeker = await prisma.user.create({
    data: {
      email: `marketplace-seeker-${suffix}@example.invalid`,
      passwordHash: "integration-test-only-not-a-real-password-hash",
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  const fixture = { requestId: null, userIds: [seeker.id] };
  fixtures.push(fixture);
  const providers = await Promise.all(Array.from({ length: providerCount }, (_, index) =>
    prisma.user.create({
      data: {
        email: `marketplace-provider-${index}-${suffix}@example.invalid`,
        passwordHash: "integration-test-only-not-a-real-password-hash",
        emailVerifiedAt: new Date(),
      },
      select: { id: true },
    }),
  ));
  fixture.userIds.push(...providers.map((provider) => provider.id));
  const request = await prisma.serviceRequest.create({
    data: {
      seekerId: seeker.id,
      title: "Concurrency integration request",
      skillCategory: "Plumbing",
      description: "Database concurrency test fixture",
      deliveryMode: "REMOTE",
    },
    select: { id: true },
  });
  const responses = await Promise.all(providers.map((provider) =>
    prisma.providerResponse.create({
      data: {
        requestId: request.id,
        providerId: provider.id,
        hourlyRateAtOffer: "250.00",
        assessmentFeeAtOffer: "0.00",
      },
      select: { id: true, providerId: true },
    }),
  ));
  fixture.requestId = request.id;
  return { seekerId: seeker.id, requestId: request.id, responses };
}


async function createEngagementFixture(status = "ASSESSMENT_PENDING", workSegmentStartedAt = null) {
  const fixture = await createFixture(1);
  const response = fixture.responses[0];
  const job = await prisma.jobEngagement.create({
    data: {
      requestId: fixture.requestId,
      responseId: response.id,
      seekerId: fixture.seekerId,
      providerId: response.providerId,
      status,
      hourlyRate: "250.00",
      workStartedAt: workSegmentStartedAt,
      workSegmentStartedAt,
    },
    select: { id: true },
  });
  return { ...fixture, jobId: job.id, providerId: response.providerId };
}

test("concurrent estimate submissions cannot overwrite one another", async () => {
  const fixture = await createEngagementFixture();
  const submit = (hours) => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fixture.requestId}, 1))`;
    const job = await tx.jobEngagement.findUnique({ where: { requestId: fixture.requestId } });
    if (!job || !["ASSESSMENT_PENDING", "ESTIMATE_REJECTED"].includes(job.status)) return false;
    const total = Number(hours) * Number(job.hourlyRate);
    const changed = await tx.jobEngagement.updateMany({
      where: { id: job.id, status: job.status },
      data: { estimatedHours: hours, estimatedTotal: total, status: "ESTIMATE_SUBMITTED", estimateSubmittedAt: new Date() },
    });
    return changed.count === 1;
  });
  const outcomes = await Promise.all([submit("2.00"), submit("4.00")]);
  assert.equal(outcomes.filter(Boolean).length, 1);
  const finalJob = await prisma.jobEngagement.findUnique({ where: { id: fixture.jobId } });
  assert.equal(finalJob?.status, "ESTIMATE_SUBMITTED");
  assert.ok(["2", "4"].includes(finalJob?.estimatedHours?.toString() ?? ""));
});

test("concurrent additional-hours requests create only one pending adjustment", async () => {
  const now = new Date();
  const fixture = await createEngagementFixture("IN_PROGRESS", now);
  const requestHours = (hours) => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fixture.requestId}, 1))`;
    const job = await tx.jobEngagement.findUnique({ where: { requestId: fixture.requestId } });
    if (!job || job.status !== "IN_PROGRESS" || !job.workSegmentStartedAt || job.workPausedAt) return false;
    const pending = await tx.jobCostAdjustment.count({ where: { engagementId: job.id, status: "PENDING" } });
    if (pending) return false;
    await tx.jobCostAdjustment.create({
      data: { engagementId: job.id, requestedHours: hours, hourlyRate: job.hourlyRate, requestedAmount: Number(hours) * Number(job.hourlyRate), reason: "Concurrency test" },
    });
    return true;
  });
  const outcomes = await Promise.all([requestHours("1.00"), requestHours("2.00")]);
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.equal(await prisma.jobCostAdjustment.count({ where: { engagementId: fixture.jobId, status: "PENDING" } }), 1);
});

test("concurrent completion decisions cannot both change the submission", async () => {
  const fixture = await createEngagementFixture("COMPLETION_PENDING");
  const submission = await prisma.jobCompletionSubmission.create({
    data: { engagementId: fixture.jobId, providerId: fixture.providerId, notes: "Concurrency test completion" },
    select: { id: true },
  });
  const decide = (approved) => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fixture.requestId}, 1))`;
    const job = await tx.jobEngagement.findUnique({ where: { requestId: fixture.requestId } });
    if (!job || job.status !== "COMPLETION_PENDING") return false;
    const claimed = await tx.jobCompletionSubmission.updateMany({
      where: { id: submission.id, engagementId: job.id, status: "PENDING" },
      data: { status: approved ? "APPROVED" : "REJECTED", reviewedAt: new Date() },
    });
    if (claimed.count !== 1) return false;
    const changed = await tx.jobEngagement.updateMany({
      where: { id: job.id, status: "COMPLETION_PENDING" },
      data: { status: approved ? "COMPLETED" : "IN_PROGRESS" },
    });
    return changed.count === 1;
  });
  const outcomes = await Promise.all([decide(true), decide(false)]);
  assert.equal(outcomes.filter(Boolean).length, 1);
  const finalSubmission = await prisma.jobCompletionSubmission.findUnique({ where: { id: submission.id } });
  assert.ok(["APPROVED", "REJECTED"].includes(finalSubmission?.status ?? ""));
  const finalJob = await prisma.jobEngagement.findUnique({ where: { id: fixture.jobId } });
  assert.equal(finalJob?.status, finalSubmission?.status === "APPROVED" ? "COMPLETED" : "IN_PROGRESS");
});

test("concurrent provider selections produce exactly one selected offer", async () => {
  const fixture = await createFixture();
  const select = (responseId) => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fixture.requestId}, 0))`;
    const request = await tx.serviceRequest.findUnique({ where: { id: fixture.requestId }, select: { status: true } });
    if (request?.status !== "OPEN") return false;
    const offer = await tx.providerResponse.findFirst({
      where: { id: responseId, requestId: fixture.requestId, status: "OFFERED" },
      select: { id: true },
    });
    if (!offer) return false;
    const claimed = await tx.serviceRequest.updateMany({
      where: { id: fixture.requestId, seekerId: fixture.seekerId, status: "OPEN" },
      data: { status: "CLOSED", matchingNextAt: null },
    });
    if (claimed.count !== 1) return false;
    await tx.providerResponse.update({ where: { id: offer.id }, data: { status: "SELECTED" } });
    await tx.providerResponse.updateMany({
      where: { requestId: fixture.requestId, id: { not: offer.id }, status: "OFFERED" },
      data: { status: "WITHDRAWN" },
    });
    return true;
  });

  const results = await Promise.all(fixture.responses.map((response) => select(response.id)));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await prisma.providerResponse.count({ where: { requestId: fixture.requestId, status: "SELECTED" } }), 1);
  assert.equal(await prisma.providerResponse.count({ where: { requestId: fixture.requestId, status: "OFFERED" } }), 0);
  assert.equal((await prisma.serviceRequest.findUnique({ where: { id: fixture.requestId } }))?.status, "CLOSED");
});

test("seeker cancellation and provider selection cannot both win", async () => {
  const fixture = await createFixture();
  const selected = fixture.responses[0];
  const cancel = () => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fixture.requestId}, 0))`;
    const changed = await tx.serviceRequest.updateMany({
      where: { id: fixture.requestId, seekerId: fixture.seekerId, status: "OPEN" },
      data: { status: "CANCELLED", matchingNextAt: null },
    });
    if (changed.count !== 1) return false;
    await tx.providerResponse.updateMany({
      where: { requestId: fixture.requestId, status: "OFFERED" },
      data: { status: "WITHDRAWN" },
    });
    return true;
  });
  const select = () => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fixture.requestId}, 0))`;
    const changed = await tx.serviceRequest.updateMany({
      where: { id: fixture.requestId, seekerId: fixture.seekerId, status: "OPEN" },
      data: { status: "CLOSED", matchingNextAt: null },
    });
    if (changed.count !== 1) return false;
    await tx.providerResponse.update({ where: { id: selected.id }, data: { status: "SELECTED" } });
    await tx.providerResponse.updateMany({
      where: { requestId: fixture.requestId, id: { not: selected.id }, status: "OFFERED" },
      data: { status: "WITHDRAWN" },
    });
    return true;
  });

  const outcomes = await Promise.all([cancel(), select()]);
  assert.equal(outcomes.filter(Boolean).length, 1);
  const request = await prisma.serviceRequest.findUnique({ where: { id: fixture.requestId }, select: { status: true } });
  const responses = await prisma.providerResponse.findMany({ where: { requestId: fixture.requestId }, select: { status: true } });
  if (request?.status === "CANCELLED") {
    assert.ok(responses.every((response) => response.status === "WITHDRAWN"));
  } else {
    assert.equal(request?.status, "CLOSED");
    assert.equal(responses.filter((response) => response.status === "SELECTED").length, 1);
    assert.ok(responses.every((response) => response.status !== "OFFERED"));
  }
});

test("duplicate matching dispatch inserts one match and one notification per provider", async () => {
  const fixture = await createFixture(1);
  const providerId = fixture.responses[0].providerId;
  const dispatch = () => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fixture.requestId}, 0))`;
    const inserted = await tx.requestMatch.createManyAndReturn({
      data: [{ requestId: fixture.requestId, providerId, score: 90, wave: 1 }],
      skipDuplicates: true,
      select: { providerId: true },
    });
    if (inserted.length) {
      await tx.appNotification.createMany({
        data: inserted.map((match) => ({
          userId: match.providerId,
          title: "New service request",
          body: "A matching request is available.",
          data: { type: "NEW_SERVICE_REQUEST", requestId: fixture.requestId },
        })),
      });
    }
    return inserted.length;
  });

  const insertedCounts = await Promise.all([dispatch(), dispatch()]);
  assert.deepEqual(insertedCounts.sort(), [0, 1]);
  assert.equal(await prisma.requestMatch.count({ where: { requestId: fixture.requestId } }), 1);
  assert.equal(await prisma.appNotification.count({
    where: { userId: providerId, data: { path: ["requestId"], equals: fixture.requestId } },
  }), 1);
});
