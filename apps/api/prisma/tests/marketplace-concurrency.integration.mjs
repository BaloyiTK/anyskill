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

test("declining the final outstanding offer schedules the next matching wave", async () => {
  const fixture = await createFixture(3);
  for (const response of fixture.responses) {
    await prisma.requestMatch.create({
      data: { requestId: fixture.requestId, providerId: response.providerId, status: "RESPONDED", wave: 1, score: 0 },
    });
  }
  const decline = (responseId, providerId) => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fixture.requestId}, 0))`;
    const changed = await tx.providerResponse.updateMany({
      where: { id: responseId, requestId: fixture.requestId, status: "OFFERED" },
      data: { status: "DECLINED" },
    });
    if (changed.count !== 1) return false;
    await tx.requestMatch.updateMany({
      where: { requestId: fixture.requestId, providerId, status: "RESPONDED" },
      data: { status: "EXPIRED" },
    });
    const pending = await tx.providerResponse.count({ where: { requestId: fixture.requestId, status: "OFFERED" } });
    if (pending === 0) {
      await tx.serviceRequest.update({
        where: { id: fixture.requestId },
        data: { matchingNextAt: new Date(), matchingExhaustedAt: null },
      });
    }
    return pending === 0;
  });
  const outcomes = await Promise.all(fixture.responses.map((response) => decline(response.id, response.providerId)));
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.equal(await prisma.providerResponse.count({ where: { requestId: fixture.requestId, status: "OFFERED" } }), 0);
  const request = await prisma.serviceRequest.findUnique({ where: { id: fixture.requestId }, select: { status: true, matchingNextAt: true } });
  assert.equal(request?.status, "OPEN");
  assert.ok(request?.matchingNextAt && request.matchingNextAt <= new Date());
  assert.equal(await prisma.providerResponse.count({ where: { requestId: fixture.requestId, status: "DECLINED" } }), 3);
  assert.equal(await prisma.requestMatch.count({ where: { requestId: fixture.requestId, status: "EXPIRED" } }), 3);
});

test("provider offer selection and seeker decline cannot both win", async () => {
  const fixture = await createFixture(1);
  const responseId = fixture.responses[0].id;
  const select = () => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fixture.requestId}, 0))`;
    const request = await tx.serviceRequest.findUnique({ where: { id: fixture.requestId }, select: { status: true } });
    const offer = await tx.providerResponse.findFirst({ where: { id: responseId, requestId: fixture.requestId, status: "OFFERED" }, select: { id: true } });
    if (!request || request.status !== "OPEN" || !offer) return false;
    await tx.serviceRequest.update({ where: { id: fixture.requestId }, data: { status: "CLOSED" } });
    await tx.providerResponse.update({ where: { id: responseId }, data: { status: "SELECTED" } });
    return true;
  });
  const decline = () => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fixture.requestId}, 0))`;
    const request = await tx.serviceRequest.findUnique({ where: { id: fixture.requestId }, select: { seekerId: true, status: true } });
    if (!request || request.status !== "OPEN" || request.seekerId !== fixture.seekerId) return false;
    const changed = await tx.providerResponse.updateMany({
      where: { id: responseId, requestId: fixture.requestId, status: "OFFERED" },
      data: { status: "DECLINED" },
    });
    return changed.count === 1;
  });
  const outcomes = await Promise.all([select(), decline()]);
  assert.equal(outcomes.filter(Boolean).length, 1);
  const offer = await prisma.providerResponse.findUnique({ where: { id: responseId }, select: { status: true } });
  const request = await prisma.serviceRequest.findUnique({ where: { id: fixture.requestId }, select: { status: true } });
  assert.ok(["SELECTED", "DECLINED"].includes(offer?.status ?? ""));
  assert.equal(request?.status, offer?.status === "SELECTED" ? "CLOSED" : "OPEN");
});

test("Provider withdrawals only advance matching after the final outstanding offer is withdrawn", async () => {
  const fixture = await createFixture(2);
  for (const response of fixture.responses) {
    await prisma.requestMatch.create({
      data: { requestId: fixture.requestId, providerId: response.providerId, status: "RESPONDED", wave: 1, score: 0 },
    });
  }
  const withdraw = (response) => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fixture.requestId}, 0))`;
    const changed = await tx.providerResponse.updateMany({
      where: { id: response.id, requestId: fixture.requestId, providerId: response.providerId, status: "OFFERED" },
      data: { status: "WITHDRAWN" },
    });
    if (changed.count !== 1) return false;
    await tx.requestMatch.updateMany({
      where: { requestId: fixture.requestId, providerId: response.providerId, status: "RESPONDED" },
      data: { status: "EXPIRED" },
    });
    const pending = await tx.providerResponse.count({ where: { requestId: fixture.requestId, status: "OFFERED" } });
    if (pending === 0) {
      await tx.serviceRequest.update({
        where: { id: fixture.requestId },
        data: { matchingNextAt: new Date(), matchingExhaustedAt: null },
      });
    }
    return pending === 0;
  });
  const first = await withdraw(fixture.responses[0]);
  assert.equal(first, false);
  const afterFirst = await prisma.serviceRequest.findUnique({ where: { id: fixture.requestId }, select: { matchingNextAt: true } });
  assert.equal(afterFirst?.matchingNextAt, null);
  const second = await withdraw(fixture.responses[1]);
  assert.equal(second, true);
  const afterSecond = await prisma.serviceRequest.findUnique({ where: { id: fixture.requestId }, select: { status: true, matchingNextAt: true } });
  assert.equal(afterSecond?.status, "OPEN");
  assert.ok(afterSecond?.matchingNextAt && afterSecond.matchingNextAt <= new Date());
  assert.equal(await prisma.providerResponse.count({ where: { requestId: fixture.requestId, status: "WITHDRAWN" } }), 2);
  assert.equal(await prisma.requestMatch.count({ where: { requestId: fixture.requestId, status: "EXPIRED" } }), 2);
});

test("seeker cancellation notifies every matched Provider and closes their outstanding matches", async () => {
  const fixture = await createFixture(3);
  for (const response of fixture.responses) {
    await prisma.requestMatch.create({
      data: { requestId: fixture.requestId, providerId: response.providerId, status: "NOTIFIED", wave: 1, score: 0 },
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fixture.requestId}, 0))`;
    const matches = await tx.requestMatch.findMany({
      where: { requestId: fixture.requestId, status: { in: ["NOTIFIED", "RESPONDED"] }, providerId: { not: null } },
      select: { providerId: true },
    });
    await tx.serviceRequest.update({ where: { id: fixture.requestId }, data: { status: "CANCELLED", matchingNextAt: null } });
    await tx.requestMatch.updateMany({ where: { requestId: fixture.requestId, status: "NOTIFIED" }, data: { status: "EXPIRED" } });
    await tx.providerResponse.updateMany({ where: { requestId: fixture.requestId, status: "OFFERED" }, data: { status: "WITHDRAWN" } });
    await tx.appNotification.createMany({
      data: [...new Set(matches.map((match) => match.providerId).filter(Boolean))].map((providerId) => ({
        userId: providerId,
        title: "Service request cancelled",
        body: "The Skill Seeker has cancelled this service request.",
        data: { type: "REQUEST_CANCELLED", requestId: fixture.requestId },
      })),
    });
  });
  assert.equal(await prisma.appNotification.count({
    where: { userId: { in: fixture.responses.map((response) => response.providerId) }, data: { path: ["type"], equals: "REQUEST_CANCELLED" } },
  }), 3);
  assert.equal(await prisma.requestMatch.count({ where: { requestId: fixture.requestId, status: "EXPIRED" } }), 3);
  assert.equal(await prisma.providerResponse.count({ where: { requestId: fixture.requestId, status: "WITHDRAWN" } }), 3);
});

test("Provider GPS heartbeat cannot race an identity rejection and leave location online", async () => {
  const fixture = await createFixture(1);
  const providerId = fixture.responses[0].providerId;
  await prisma.user.update({
    where: { id: providerId },
    data: { providerRoleStatus: "ACTIVE", identityVerification: "VERIFIED", identityVerifiedAt: new Date() },
  });
  await prisma.providerProfile.create({
    data: {
      userId: providerId,
      publicName: "Concurrency Provider",
      isAvailable: true,
      liveLatitude: -26.2041,
      liveLongitude: 28.0473,
      liveAccuracyM: 10,
      liveLocationUpdatedAt: new Date(),
    },
  });

  const heartbeat = () => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('provider-eligibility'), hashtext(${providerId}))`;
    const user = await tx.user.findUnique({
      where: { id: providerId },
      select: { providerRoleStatus: true, identityVerification: true },
    });
    if (user?.providerRoleStatus !== "ACTIVE" || user.identityVerification !== "VERIFIED") return false;
    await tx.providerProfile.update({
      where: { userId: providerId },
      data: { liveLatitude: -26.205, liveLongitude: 28.048, liveAccuracyM: 8, liveLocationUpdatedAt: new Date() },
    });
    return true;
  });
  const rejectIdentity = () => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('provider-eligibility'), hashtext(${providerId}))`;
    await tx.user.update({
      where: { id: providerId },
      data: { identityVerification: "FAILED", identityVerifiedAt: null, providerRoleStatus: "PENDING" },
    });
    await tx.providerProfile.update({
      where: { userId: providerId },
      data: { isAvailable: false, liveLatitude: null, liveLongitude: null, liveAccuracyM: null, liveLocationUpdatedAt: null },
    });
  });

  await Promise.all([heartbeat(), rejectIdentity()]);
  const [user, profile] = await Promise.all([
    prisma.user.findUnique({ where: { id: providerId }, select: { identityVerification: true, providerRoleStatus: true } }),
    prisma.providerProfile.findUnique({ where: { userId: providerId }, select: { isAvailable: true, liveLatitude: true, liveLongitude: true, liveLocationUpdatedAt: true } }),
  ]);
  assert.equal(user?.identityVerification, "FAILED");
  assert.equal(user?.providerRoleStatus, "PENDING");
  assert.equal(profile?.isAvailable, false);
  assert.equal(profile?.liveLatitude, null);
  assert.equal(profile?.liveLongitude, null);
  assert.equal(profile?.liveLocationUpdatedAt, null);
});

test("Provider declines expire only their own invitation and advance after the final unanswered match", async () => {
  const fixture = await createFixture(2);
  await prisma.providerResponse.deleteMany({ where: { requestId: fixture.requestId } });
  const matches = [];
  for (const response of fixture.responses) {
    matches.push(await prisma.requestMatch.create({
      data: { requestId: fixture.requestId, providerId: response.providerId, status: "NOTIFIED", wave: 1, score: 0 },
      select: { id: true, providerId: true },
    }));
  }
  const decline = (match) => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fixture.requestId}, 0))`;
    const changed = await tx.requestMatch.updateMany({
      where: { id: match.id, requestId: fixture.requestId, providerId: match.providerId, status: "NOTIFIED" },
      data: { status: "EXPIRED" },
    });
    if (changed.count !== 1) return false;
    const pendingOffers = await tx.providerResponse.count({ where: { requestId: fixture.requestId, status: "OFFERED" } });
    const pendingMatches = await tx.requestMatch.count({ where: { requestId: fixture.requestId, status: "NOTIFIED" } });
    if (pendingOffers === 0 && pendingMatches === 0) {
      await tx.serviceRequest.update({ where: { id: fixture.requestId }, data: { matchingNextAt: new Date(), matchingExhaustedAt: null } });
      return true;
    }
    if (pendingOffers === 0 && pendingMatches > 0) {
      await tx.serviceRequest.update({ where: { id: fixture.requestId }, data: { matchingNextAt: new Date(Date.now() + 300_000) } });
    }
    return false;
  });
  assert.equal(await decline(matches[0]), false);
  const afterFirst = await prisma.serviceRequest.findUnique({ where: { id: fixture.requestId }, select: { matchingNextAt: true } });
  assert.ok(afterFirst?.matchingNextAt && afterFirst.matchingNextAt > new Date());
  assert.equal(await decline(matches[1]), true);
  const afterSecond = await prisma.serviceRequest.findUnique({ where: { id: fixture.requestId }, select: { matchingNextAt: true } });
  assert.ok(afterSecond?.matchingNextAt && afterSecond.matchingNextAt <= new Date());
  assert.equal(await prisma.requestMatch.count({ where: { requestId: fixture.requestId, status: "EXPIRED" } }), 2);
});

test("a Provider cannot accept an invitation after it has been declined or expired", async () => {
  const fixture = await createFixture(1);
  const response = fixture.responses[0];
  await prisma.providerResponse.deleteMany({ where: { requestId: fixture.requestId, providerId: response.providerId } });
  await prisma.requestMatch.create({
    data: { requestId: fixture.requestId, providerId: response.providerId, status: "EXPIRED", wave: 1, score: 0 },
  });
  const accepted = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fixture.requestId}, 0))`;
    const match = await tx.requestMatch.findUnique({
      where: { requestId_providerId: { requestId: fixture.requestId, providerId: response.providerId } },
      select: { status: true },
    });
    return match?.status === "NOTIFIED";
  });
  assert.equal(accepted, false);
  assert.equal(await prisma.providerResponse.count({ where: { requestId: fixture.requestId, providerId: response.providerId } }), 0);
});

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


test("database enforces one pending adjustment and completion per engagement", async () => {
  const fixture = await createEngagementFixture("IN_PROGRESS", new Date());
  await prisma.jobCostAdjustment.create({
    data: { engagementId: fixture.jobId, requestedHours: "1.00", hourlyRate: "250.00", requestedAmount: "250.00", reason: "First pending request" },
  });
  await assert.rejects(
    prisma.jobCostAdjustment.create({
      data: { engagementId: fixture.jobId, requestedHours: "2.00", hourlyRate: "250.00", requestedAmount: "500.00", reason: "Duplicate pending request" },
    }),
    (error) => error?.code === "P2002",
  );

  await prisma.jobCompletionSubmission.create({
    data: { engagementId: fixture.jobId, providerId: fixture.providerId, notes: "First pending completion" },
  });
  await assert.rejects(
    prisma.jobCompletionSubmission.create({
      data: { engagementId: fixture.jobId, providerId: fixture.providerId, notes: "Duplicate pending completion" },
    }),
    (error) => error?.code === "P2002",
  );
});

test("service request idempotency key is unique per seeker and binds the original payload", async () => {
  const fixture = await createFixture(0);
  const key = randomUUID();
  const payloadHash = "a".repeat(64);
  await prisma.serviceRequest.update({
    where: { id: fixture.requestId },
    data: { idempotencyKey: key, idempotencyPayloadHash: payloadHash },
  });
  await assert.rejects(
    prisma.serviceRequest.create({
      data: {
        seekerId: fixture.seekerId,
        idempotencyKey: key,
        idempotencyPayloadHash: payloadHash,
        title: "Retry duplicate request",
        skillCategory: "Plumbing",
        description: "Same client retry should not create another service request.",
        deliveryMode: "REMOTE",
      },
    }),
    (error) => error?.code === "P2002",
  );
  const persisted = await prisma.serviceRequest.findFirst({
    where: { seekerId: fixture.seekerId, idempotencyKey: key },
    select: { id: true, idempotencyPayloadHash: true },
  });
  assert.equal(persisted?.id, fixture.requestId);
  assert.equal(persisted?.idempotencyPayloadHash, payloadHash);
});

test("only one API replica can claim a media upload for verification", async () => {
  const fixture = await createFixture(1);
  const providerId = fixture.responses[0].providerId;
  const asset = await prisma.mediaAsset.create({
    data: {
      userId: providerId,
      objectKey: `anyskill/job-completion-evidence/${providerId}/${randomUUID()}`,
      originalName: "evidence.jpg",
      contentType: "image/jpeg",
      sizeBytes: 1024,
      purpose: "JOB_COMPLETION_EVIDENCE",
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
    select: { id: true },
  });
  const claim = () => prisma.mediaAsset.updateMany({
    where: { id: asset.id, userId: providerId, status: "PENDING" },
    data: { status: "VERIFYING", verificationStartedAt: new Date() },
  });
  const results = await Promise.all([claim(), claim()]);
  assert.equal(results.reduce((total, result) => total + result.count, 0), 1);
  const finalAsset = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
  assert.equal(finalAsset?.status, "VERIFYING");
  assert.ok(finalAsset?.verificationStartedAt);
});

test("a completion evidence asset can be claimed by only one submission", async () => {
  const fixture = await createEngagementFixture("COMPLETION_PENDING");
  const asset = await prisma.mediaAsset.create({
    data: {
      userId: fixture.providerId,
      objectKey: `anyskill/job-completion-evidence/${fixture.providerId}/${randomUUID()}`,
      originalName: "evidence.jpg",
      contentType: "image/jpeg",
      sizeBytes: 1024,
      purpose: "JOB_COMPLETION_EVIDENCE",
      status: "READY",
      uploadedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
    select: { id: true },
  });
  const first = await prisma.jobCompletionSubmission.create({
    data: { engagementId: fixture.jobId, providerId: fixture.providerId, notes: "First claim", status: "APPROVED" },
    select: { id: true },
  });
  const second = await prisma.jobCompletionSubmission.create({
    data: { engagementId: fixture.jobId, providerId: fixture.providerId, notes: "Second claim", status: "REJECTED" },
    select: { id: true },
  });
  const claim = (submissionId) => prisma.mediaAsset.updateMany({
    where: { id: asset.id, userId: fixture.providerId, status: "READY", completionSubmissionId: null },
    data: { completionSubmissionId: submissionId },
  });
  const results = await Promise.all([claim(first.id), claim(second.id)]);
  assert.equal(results.reduce((total, result) => total + result.count, 0), 1);
  const persisted = await prisma.mediaAsset.findUnique({ where: { id: asset.id }, select: { completionSubmissionId: true } });
  assert.ok([first.id, second.id].includes(persisted?.completionSubmissionId));
});

test("media upload idempotency keys cannot create duplicate reservations for one user", async () => {
  const fixture = await createFixture(1);
  const userId = fixture.responses[0].providerId;
  const key = randomUUID();
  const payloadHash = "b".repeat(64);
  const asset = await prisma.mediaAsset.create({
    data: {
      userId,
      idempotencyKey: key,
      idempotencyPayloadHash: payloadHash,
      objectKey: `anyskill/job-completion-evidence/${userId}/${randomUUID()}`,
      originalName: "same-photo.jpg",
      contentType: "image/jpeg",
      sizeBytes: 2048,
      purpose: "JOB_COMPLETION_EVIDENCE",
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  await assert.rejects(
    prisma.mediaAsset.create({
      data: {
        userId,
        idempotencyKey: key,
        idempotencyPayloadHash: payloadHash,
        objectKey: `anyskill/job-completion-evidence/${userId}/${randomUUID()}`,
        originalName: "same-photo.jpg",
        contentType: "image/jpeg",
        sizeBytes: 2048,
        purpose: "JOB_COMPLETION_EVIDENCE",
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    }),
    (error) => error?.code === "P2002",
  );
  const persisted = await prisma.mediaAsset.findFirst({ where: { userId, idempotencyKey: key } });
  assert.equal(persisted?.id, asset.id);
});

test("completion submission idempotency keys are unique per engagement", async () => {
  const fixture = await createEngagementFixture("COMPLETION_PENDING");
  const key = randomUUID();
  const payloadHash = "c".repeat(64);
  const submission = await prisma.jobCompletionSubmission.create({
    data: {
      engagementId: fixture.jobId,
      providerId: fixture.providerId,
      notes: "Idempotent completion submission",
      idempotencyKey: key,
      idempotencyPayloadHash: payloadHash,
      status: "APPROVED",
    },
  });
  await assert.rejects(
    prisma.jobCompletionSubmission.create({
      data: {
        engagementId: fixture.jobId,
        providerId: fixture.providerId,
        notes: "Idempotent completion submission",
        idempotencyKey: key,
        idempotencyPayloadHash: payloadHash,
        status: "REJECTED",
      },
    }),
    (error) => error?.code === "P2002",
  );
  const persisted = await prisma.jobCompletionSubmission.findFirst({
    where: { engagementId: fixture.jobId, idempotencyKey: key },
  });
  assert.equal(persisted?.id, submission.id);
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

test("notification queue selects distinct recipients before applying its page limit", async () => {
  const fixture = await createFixture(1);
  const noisyProviderId = fixture.responses[0].providerId;
  const otherRecipientId = fixture.seekerId;
  await prisma.appNotification.createMany({
    data: Array.from({ length: 12 }, (_, index) => ({
      userId: noisyProviderId,
      title: `Noisy account notification ${index}`,
      body: "Queue fairness integration test",
      data: { type: "QUEUE_FAIRNESS_TEST", index },
    })),
  });
  await prisma.appNotification.create({
    data: {
      userId: otherRecipientId,
      title: "Other account notification",
      body: "Must not be starved by another recipient",
      data: { type: "QUEUE_FAIRNESS_TEST" },
    },
  });

  const selected = await prisma.$queryRaw<Array<{ userId: string }>>`
    SELECT DISTINCT ON (user_id) user_id AS "userId"
    FROM app_notifications
    WHERE delivery_status = 'PENDING'
      AND attempts < 5
      AND next_attempt_at <= NOW()
      AND data->>'type' = 'QUEUE_FAIRNESS_TEST'
    ORDER BY user_id, created_at ASC, id ASC
    LIMIT 10
  `;
  assert.equal(new Set(selected.map((row) => row.userId)).size, selected.length);
  assert.ok(selected.some((row) => row.userId === otherRecipientId));
  assert.ok(selected.some((row) => row.userId === noisyProviderId));
});

test("business notification event keys are unique and notification failure rolls back the business transaction", async () => {
  const fixture = await createFixture(1);
  const providerId = fixture.responses[0].providerId;
  const eventKey = `integration:${randomUUID()}:business-event`;
  await prisma.appNotification.create({
    data: { userId: providerId, eventKey, title: "Event key fixture", body: "Unique event key test" },
  });
  await assert.rejects(
    prisma.appNotification.create({
      data: { userId: providerId, eventKey, title: "Duplicate event key", body: "Must be rejected" },
    }),
    (error) => error?.code === "P2002",
  );

  const original = await prisma.serviceRequest.findUniqueOrThrow({
    where: { id: fixture.requestId }, select: { title: true },
  });
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.serviceRequest.update({
        where: { id: fixture.requestId }, data: { title: "Must roll back" },
      });
      await tx.appNotification.create({
        data: { userId: providerId, eventKey, title: "Duplicate", body: "Force transaction rollback" },
      });
    }),
    (error) => error?.code === "P2002",
  );
  const persisted = await prisma.serviceRequest.findUniqueOrThrow({
    where: { id: fixture.requestId }, select: { title: true },
  });
  assert.equal(persisted.title, original.title);
});

test("stale notification claims become UNKNOWN instead of being blindly resent", async () => {
  const fixture = await createFixture(1);
  const providerId = fixture.responses[0].providerId;
  const notification = await prisma.appNotification.create({
    data: {
      userId: providerId,
      title: "Ambiguous Expo delivery",
      body: "Simulate worker interruption after outbound request",
      deliveryStatus: "SENDING",
      attempts: 1,
      sendingStartedAt: new Date(Date.now() - 3 * 60_000),
    },
    select: { id: true },
  });

  const recovered = await prisma.$executeRaw`
    UPDATE app_notifications AS notification
    SET delivery_status = CASE
          WHEN EXISTS (
            SELECT 1 FROM push_notification_receipts AS receipt
            WHERE receipt.notification_id = notification.id
          ) THEN 'SENT'::"NotificationDeliveryStatus"
          ELSE 'UNKNOWN'::"NotificationDeliveryStatus"
        END,
        sending_started_at = NULL
    WHERE notification.id = ${notification.id}::uuid
      AND notification.delivery_status = 'SENDING'::"NotificationDeliveryStatus"
      AND notification.sending_started_at < ${new Date(Date.now() - 2 * 60_000)}
  `;
  assert.equal(recovered, 1);
  const persisted = await prisma.appNotification.findUniqueOrThrow({
    where: { id: notification.id },
    select: { deliveryStatus: true, sendingStartedAt: true, attempts: true },
  });
  assert.equal(persisted.deliveryStatus, "UNKNOWN");
  assert.equal(persisted.sendingStartedAt, null);
  assert.equal(persisted.attempts, 1);
});
