import test from "node:test";
import assert from "node:assert/strict";
import { MarketplaceService } from "../dist/marketplace/marketplace.service.js";

function serviceWith(transaction) {
  const prisma = {
    $transaction: async (callback) => callback(transaction),
    user: { findUnique: async () => ({ identityVerification: "VERIFIED", providerProfile: { hourlyRate: 250, assessmentFee: 0 } }) },
  };
  return new MarketplaceService(prisma, {});
}

test("decline immediately advances matching after recording the Provider response", async () => {
  const calls = [];
  const tx = {
    serviceRequest: {
      findFirst: async () => ({ matchingWave: 2 }),
      updateMany: async (args) => { calls.push(["request-next", args]); return { count: 1 }; },
    },
    requestMatch: { updateMany: async (args) => { calls.push(["match", args]); return { count: 1 }; } },
    providerResponse: { create: async (args) => { calls.push(["response", args]); return { id: "response-1" }; } },
  };
  const service = serviceWith(tx);
  service.dispatchNextWave = async (...args) => { calls.push(["dispatch", args]); return { notified: 1, wave: 3 }; };
  const result = await service.declineIncomingRequest("provider-1", "request-1");

  assert.deepEqual(result, { success: true, requestId: "request-1", status: "DECLINED", matching: { notified: 1, wave: 3 } });
  assert.deepEqual(calls.find(([name]) => name === "match")[1], {
    where: { requestId: "request-1", providerId: "provider-1", status: "NOTIFIED", request: { status: "OPEN" } },
    data: { status: "EXPIRED" },
  });
  assert.deepEqual(calls.find(([name]) => name === "response")[1], {
    data: { requestId: "request-1", providerId: "provider-1", status: "DECLINED" },
  });
  assert.ok(calls.findIndex(([name]) => name === "response") < calls.findIndex(([name]) => name === "dispatch"));
  assert.deepEqual(calls.find(([name]) => name === "dispatch")[1], ["request-1", 3]);
});

test("decline rejects a request that is no longer awaiting this provider", async () => {
  let responseCreated = false;
  const tx = {
    serviceRequest: { findFirst: async () => ({ matchingWave: 1 }) },
    requestMatch: { updateMany: async () => ({ count: 0 }) },
    providerResponse: { create: async () => { responseCreated = true; } },
  };
  await assert.rejects(
    serviceWith(tx).declineIncomingRequest("different-provider", "request-1"),
    (error) => error.getStatus?.() === 409,
  );
  assert.equal(responseCreated, false);
});

test("accept cannot create an offer after the provider match has expired or been declined", async () => {
  let responseCreated = false;
  const tx = {
    serviceRequest: { findUnique: async () => ({ id: "request-1", seekerId: "seeker-1", status: "OPEN" }) },
    requestMatch: { findUnique: async () => ({ id: "match-1", status: "EXPIRED" }) },
    providerResponse: { create: async () => { responseCreated = true; } },
  };
  await assert.rejects(
    serviceWith(tx).respondToRequest("provider-1", "request-1", {}),
    (error) => error.getStatus?.() === 409,
  );
  assert.equal(responseCreated, false);
});


test("declining a Seeker offer atomically withdraws the exact offer and notifies its Provider", async () => {
  const calls = [];
  const tx = {
    serviceRequest: {
      findFirst: async (args) => { calls.push(["request", args]); return { id: "request-1", matchingWave: 2 }; },
      updateMany: async (args) => { calls.push(["request-update", args]); return { count: 1 }; },
    },
    providerResponse: {
      updateMany: async (args) => { calls.push(["offer-update", args]); return { count: 1 }; },
      findFirst: async () => ({ providerId: "provider-1" }),
    },
    appNotification: { create: async (args) => { calls.push(["notification", args]); } },
  };
  const service = serviceWith(tx);
  service.dispatchNextWave = async (...args) => { calls.push(["dispatch", args]); return { notified: 1, wave: 3 }; };

  const result = await service.declineProviderOffer("seeker-1", "request-1", "response-1");

  assert.deepEqual(result, {
    success: true, requestId: "request-1", responseId: "response-1",
    status: "WITHDRAWN", matching: { notified: 1, wave: 3 },
  });
  assert.deepEqual(calls.find(([name]) => name === "offer-update")[1], {
    where: {
      id: "response-1",
      requestId: "request-1",
      status: "OFFERED",
      request: { is: { id: "request-1", seekerId: "seeker-1", status: "OPEN" } },
    },
    data: { status: "WITHDRAWN" },
  });
  assert.equal(calls.find(([name]) => name === "notification")[1].data.userId, "provider-1");
  assert.ok(calls.findIndex(([name]) => name === "notification") < calls.findIndex(([name]) => name === "dispatch"));
});

test("declining an offer fails closed when selection or cancellation already changed it", async () => {
  let notificationCreated = false;
  let dispatched = false;
  const tx = {
    serviceRequest: { findFirst: async () => ({ id: "request-1", matchingWave: 1 }) },
    providerResponse: {
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => ({ providerId: "provider-1" }),
    },
    appNotification: { create: async () => { notificationCreated = true; } },
  };
  const service = serviceWith(tx);
  service.dispatchNextWave = async () => { dispatched = true; return { notified: 0, wave: 2 }; };

  await assert.rejects(
    service.declineProviderOffer("seeker-1", "request-1", "response-1"),
    (error) => error.getStatus?.() === 409,
  );
  assert.equal(notificationCreated, false);
  assert.equal(dispatched, false);
});

test("initial matching failure leaves the newly created request queued for worker recovery", async () => {
  let createArgs;
  const service = new MarketplaceService({
    user: { findUnique: async () => ({ identityVerification: "VERIFIED" }) },
    serviceRequest: {
      create: async (args) => {
        createArgs = args;
        return {
          id: "request-queued",
          title: args.data.title,
          skillCategory: args.data.skillCategory,
          description: args.data.description,
          imageUrls: args.data.imageUrls,
          location: args.data.location,
          deliveryMode: args.data.deliveryMode,
          matchingStartedAt: new Date(),
          preferredStartAt: args.data.preferredStartAt,
          instructions: args.data.instructions,
          status: "OPEN",
          createdAt: new Date(),
        };
      },
    },
  }, {});
  service.dispatchNextWave = async () => { throw new Error("temporary matching outage"); };

  const result = await service.createRequest("seeker-1", {
    title: "Repair a leaking tap",
    skillCategory: "plumber",
    description: "Kitchen tap is leaking",
    deliveryMode: "REMOTE",
  });

  assert.ok(createArgs.data.matchingNextAt instanceof Date);
  assert.deepEqual(result.matching, { notified: 0, wave: 0, queued: true });
});


test("cancelling an open request notifies all matched Providers and pending-offer Providers once", async () => {
  const calls = [];
  const tx = {
    serviceRequest: {
      findFirst: async () => ({ id: "request-1", title: "Fix a tap", status: "OPEN" }),
      updateMany: async (args) => { calls.push(["request-update", args]); return { count: 1 }; },
    },
    requestMatch: {
      findMany: async () => [{ providerId: "provider-1" }, { providerId: "provider-2" }],
      updateMany: async (args) => { calls.push(["matches-expired", args]); return { count: 2 }; },
    },
    providerResponse: {
      findMany: async () => [{ id: "offer-1", providerId: "provider-2" }, { id: "offer-2", providerId: "provider-3" }],
      updateMany: async (args) => { calls.push(["offers-withdrawn", args]); return { count: 2 }; },
    },
    appNotification: { createMany: async (args) => { calls.push(["notifications", args]); } },
  };
  const result = await serviceWith(tx).cancelRequest("seeker-1", "request-1");
  assert.deepEqual(result, { success: true, requestId: "request-1", status: "CANCELLED" });
  const notifications = calls.find(([name]) => name === "notifications")[1].data;
  assert.deepEqual(notifications.map((item) => item.userId).sort(), ["provider-1", "provider-2", "provider-3"]);
  assert.equal(notifications.length, 3);
  assert.ok(notifications.every((item) => item.data.type === "SERVICE_CANCELLED_BY_SEEKER"));
});

test("matching skips busy Providers and requires an approved matching skill", async () => {
  const calls = [];
  const request = {
    id: "request-1", seekerId: "seeker-1", skillCategory: "plumber",
    location: null, latitude: null, longitude: null, searchRadiusKm: 10,
    deliveryMode: "REMOTE", status: "OPEN", matchingStartedAt: new Date(),
    matchingWave: 1,
  };
  const tx = {
    $queryRaw: async (query) => { calls.push(["lock", String(query)]); return []; },
    serviceRequest: {
      findUnique: async () => request,
      update: async (args) => { calls.push(["request-update", args]); },
    },
    requestMatch: {
      findMany: async () => [],
      findFirst: async ({ where }) => where.providerId === "busy-provider" ? { id: "active-match" } : null,
      create: async (args) => { calls.push(["match-create", args]); },
    },
    providerSkill: {
      findMany: async ({ where }) => where.userId === "pending-skill-provider"
        ? [{ category: "plumber" }]
        : [{ category: "plumber" }],
    },
    providerResponse: { findFirst: async () => null },
    jobEngagement: { findFirst: async () => null },
    appNotification: { create: async (args) => { calls.push(["notification", args]); } },
  };
  const prisma = {
    serviceRequest: { findUnique: async () => request },
    $transaction: async (callback) => callback(tx),
  };
  const service = new MarketplaceService(prisma, {});
  service.rankedProviders = async () => [
    { userId: "busy-provider", score: 9000 },
    { userId: "pending-skill-provider", score: 8000 },
    { userId: "eligible-provider", score: 7000 },
  ];
  tx.providerSkill.findMany = async ({ where }) => where.userId === "pending-skill-provider"
    ? []
    : [{ category: "plumber" }];

  const result = await service.dispatchNextWave("request-1", 2);

  assert.equal(result.notified, 1);
  assert.equal(result.wave, 2);
  assert.equal(calls.filter(([name]) => name === "lock").length, 4);
  assert.equal(calls.find(([name]) => name === "match-create")[1].data.providerId, "eligible-provider");
  assert.equal(calls.find(([name]) => name === "notification")[1].data.userId, "eligible-provider");
});

test("accept revalidates active Provider status and approved skill before creating an offer", async () => {
  for (const provider of [
    { identityVerification: "VERIFIED", providerRoleStatus: "PENDING", providerProfile: { hourlyRate: 250, assessmentFee: 0 } },
    { identityVerification: "VERIFIED", providerRoleStatus: "ACTIVE", providerProfile: { hourlyRate: 250, assessmentFee: 0 } },
  ]) {
    let responseCreated = false;
    let skillLookup;
    const tx = {
      serviceRequest: {
        findUnique: async () => ({ id: "request-1", seekerId: "seeker-1", skillCategory: "Plumber", status: "OPEN" }),
        update: async () => {},
      },
      requestMatch: {
        findUnique: async () => ({ id: "match-1", status: "NOTIFIED", notifiedAt: new Date() }),
        update: async () => {},
      },
      user: { findUnique: async () => provider },
      providerSkill: {
        findFirst: async (args) => { skillLookup = args; return provider.providerRoleStatus === "ACTIVE" ? null : { id: "skill-1" }; },
      },
      providerResponse: { create: async () => { responseCreated = true; } },
      appNotification: { create: async () => {} },
    };
    await assert.rejects(
      serviceWith(tx).respondToRequest("provider-1", "request-1", {}),
      (error) => error.getStatus?.() === 403,
    );
    assert.equal(responseCreated, false);
    if (provider.providerRoleStatus === "ACTIVE") {
      assert.deepEqual(skillLookup.where, {
        userId: "provider-1", category: "plumber", status: "APPROVED",
      });
    }
  }
});

test("notification recovery uses the start time of the active delivery attempt", async () => {
  const calls = [];
  const prisma = {
    appNotification: {
      updateMany: async (args) => { calls.push(["notification", args]); return { count: 0 }; },
    },
    notificationDeviceDelivery: {
      updateMany: async (args) => { calls.push(["device", args]); return { count: 0 }; },
    },
    welcomeEmailOutbox: {
      updateMany: async (args) => { calls.push(["welcome", args]); return { count: 0 }; },
      findMany: async () => [],
    },
  };
  const service = new MarketplaceService(prisma, {});
  service.expandExpiredWaves = async () => {};
  service.retryExhaustedRequests = async () => {};
  service.dispatchPendingNotifications = async () => {};
  service.pollExpoPushReceipts = async () => {};

  await service.runWorkerCycle();

  const recovery = calls.find(([name]) => name === "notification")[1];
  assert.deepEqual(recovery.where, {
    deliveryStatus: "SENDING",
    deliveryStartedAt: { lt: recovery.where.deliveryStartedAt.lt },
  });
  assert.ok(recovery.where.deliveryStartedAt.lt instanceof Date);
  assert.deepEqual(recovery.data, { deliveryStatus: "PENDING", deliveryStartedAt: null });
});

test("welcome email worker retries a persisted outbox item after SMTP failure", async () => {
  const updates = [];
  const prisma = {
    welcomeEmailOutbox: {
      findMany: async () => [{
        id: "welcome-1", recipientEmail: "member@example.com",
        displayName: "Sam Example", providerReviewPending: true, attempts: 1,
      }],
      updateMany: async (args) => { updates.push(args); return { count: 1 }; },
    },
  };
  const mail = {
    sendWelcomeEmail: async () => { throw Object.assign(new Error("SMTP unavailable"), { code: "ECONNECTION" }); },
  };
  const service = new MarketplaceService(prisma, {}, mail);

  await service.dispatchPendingWelcomeEmails();

  assert.deepEqual(updates[0].where, { id: "welcome-1", status: "PENDING", attempts: 1 });
  assert.deepEqual(updates[0].data, { status: "SENDING", attempts: { increment: 1 } });
  assert.equal(updates[1].where.status, "SENDING");
  assert.equal(updates[1].data.status, "PENDING");
  assert.ok(updates[1].data.nextAttemptAt instanceof Date);
  assert.equal(updates[1].data.lastError, "ECONNECTION");
});

test("matching does not dispatch the same request wave twice", async () => {
  let transactionStarted = false;
  const request = {
    id: "request-1", seekerId: "seeker-1", skillCategory: "plumber",
    location: null, latitude: null, longitude: null, searchRadiusKm: 10,
    deliveryMode: "REMOTE", status: "OPEN", matchingStartedAt: new Date(),
    matchingWave: 3,
  };
  const prisma = {
    serviceRequest: { findUnique: async () => request },
    $transaction: async (callback) => {
      transactionStarted = true;
      return callback({
        $queryRaw: async () => [],
        serviceRequest: { findUnique: async () => request },
      });
    },
  };
  const service = new MarketplaceService(prisma, {});
  service.rankedProviders = async () => { throw new Error("ranking should not run after a wave was already committed"); };

  const result = await service.dispatchNextWave("request-1", 3);

  assert.equal(transactionStarted, false);
  assert.deepEqual(result, { notified: 0, wave: 3, alreadyDispatched: true });
});
