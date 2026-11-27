import test from "node:test";
import assert from "node:assert/strict";
import { MarketplaceService } from "../dist/marketplace/marketplace.service.js";

function serviceWith(transaction) {
  // New Provider exclusivity checks query these delegates in the same
  // transaction. Default them to "no existing commitment" unless a test
  // explicitly supplies a matching row.
  const tx = { ...transaction };
  tx.jobEngagement = { findFirst: async () => null, ...transaction.jobEngagement };
  tx.providerResponse = { findFirst: async () => null, ...transaction.providerResponse };
  tx.requestMatch = { findFirst: async () => null, updateMany: async () => ({ count: 0 }), ...transaction.requestMatch };

  const prisma = {
    $transaction: async (callback) => callback(tx),
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
    $queryRaw: async () => [],
    serviceRequest: { findUnique: async () => ({ id: "request-1", seekerId: "seeker-1", status: "OPEN" }) },
    requestMatch: { findUnique: async () => ({ id: "match-1", status: "EXPIRED" }) },
    providerResponse: { create: async () => { responseCreated = true; } },
  };
  await assert.rejects(
    serviceWith(tx).respondToRequest("provider-1", "request-1"),
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
    requestMatch: {
      updateMany: async (args) => { calls.push(["match-expire", args]); return { count: 1 }; },
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
  assert.deepEqual(calls.find(([name]) => name === "match-expire")[1], {
    where: { requestId: "request-1", providerId: "provider-1", status: { in: ["NOTIFIED", "RESPONDED"] } },
    data: { status: "EXPIRED" },
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

test("an expired Provider response is released, notified, and matching advances", async () => {
  const calls = [];
  const now = new Date();
  const prisma = {
    serviceRequest: {
      findMany: async () => [{ id: "request-1", matchingWave: 2 }],
      updateMany: async (args) => { calls.push(["claim", args]); return { count: 1 }; },
      update: async (args) => { calls.push(["request-update", args]); },
    },
    providerResponse: { count: async () => 0 },
    requestMatch: {
      findMany: async (args) => {
        calls.push(["expired-matches", args]);
        return [{ providerId: "provider-1" }];
      },
      updateMany: async (args) => { calls.push(["expire-matches", args]); return { count: 1 }; },
    },
    appNotification: {
      createMany: async (args) => { calls.push(["notify", args]); },
    },
  };
  const service = new MarketplaceService(prisma, {});
  service.dispatchNextWave = async (...args) => { calls.push(["dispatch", args]); return { notified: 1, wave: 3 }; };

  await service.expandExpiredWaves();

  const expiredQuery = calls.find(([name]) => name === "expired-matches")[1];
  assert.equal(expiredQuery.where.status, "NOTIFIED");
  assert.ok(expiredQuery.where.notifiedAt.lte instanceof Date);
  assert.deepEqual(calls.find(([name]) => name === "expire-matches")[1].data, { status: "EXPIRED" });
  assert.equal(calls.find(([name]) => name === "notify")[1].data[0].userId, "provider-1");
  assert.equal(calls.find(([name]) => name === "notify")[1].data[0].data.type, "MATCHED_REQUEST_EXPIRED");
  assert.deepEqual(calls.find(([name]) => name === "dispatch")[1], ["request-1", 3]);
  assert.ok(calls.findIndex(([name]) => name === "notify") < calls.findIndex(([name]) => name === "dispatch"));
});

test("initial matching failure leaves the newly created request queued for worker recovery", async () => {
  let createArgs;
  const service = new MarketplaceService({
    user: { findUnique: async () => ({ identityVerification: "VERIFIED" }) },
    $transaction: async (callback) => callback({
      $queryRaw: async () => [],
      serviceRequest: {
        findFirst: async () => null,
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
    }),
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
    providerResponse: {
      findFirst: async (args) => { calls.push(["offer-check", args]); return null; },
    },
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
  const eligibleOfferCheck = calls.find(([name, args]) =>
    name === "offer-check" && args.where.providerId === "eligible-provider"
  );
  assert.deepEqual(eligibleOfferCheck[1], {
    where: {
      providerId: "eligible-provider",
      status: "OFFERED",
      request: { status: "OPEN" },
    },
    select: { id: true },
  });
});

test("accept revalidates active Provider status and approved skill before creating an offer", async () => {
  for (const provider of [
    { identityVerification: "VERIFIED", providerRoleStatus: "PENDING", providerProfile: { hourlyRate: 250, assessmentFee: 0 } },
    { identityVerification: "VERIFIED", providerRoleStatus: "ACTIVE", providerProfile: { hourlyRate: 250, assessmentFee: 0 } },
  ]) {
    let responseCreated = false;
    let skillLookup;
    const tx = {
      $queryRaw: async () => [],
      serviceRequest: {
        findUnique: async () => ({ id: "request-1", seekerId: "seeker-1", skillCategory: "Plumber", status: "OPEN" }),
        updateMany: async () => ({ count: 1 }),
      },
      requestMatch: {
        findUnique: async () => ({ id: "match-1", status: "NOTIFIED", notifiedAt: new Date() }),
        updateMany: async () => ({ count: 1 }),
      },
      user: { findUnique: async () => provider },
      providerSkill: {
        findFirst: async (args) => { skillLookup = args; return provider.providerRoleStatus === "ACTIVE" ? null : { id: "skill-1" }; },
      },
      providerResponse: { create: async () => { responseCreated = true; } },
      appNotification: { create: async () => {} },
    };
    await assert.rejects(
      serviceWith(tx).respondToRequest("provider-1", "request-1"),
      (error) => error.getStatus?.() === 403,
    );
    assert.equal(responseCreated, false);
    if (provider.providerRoleStatus === "ACTIVE") {
      assert.deepEqual(skillLookup.where, {
        userId: "provider-1", category: "plumber", status: "APPROVED", isPaused: false,
      });
    }
  }
});

test("Provider acceptance claims the live match before creating and notifying the Seeker offer", async () => {
  const calls = [];
  const tx = {
    $queryRaw: async () => { calls.push("request-lock"); return []; },
    serviceRequest: {
      findUnique: async () => ({ id: "request-1", seekerId: "seeker-1", skillCategory: "Plumber", status: "OPEN" }),
      updateMany: async (args) => { calls.push(["request-update", args]); return { count: 1 }; },
    },
    requestMatch: {
      findUnique: async () => ({ id: "match-1", status: "NOTIFIED", notifiedAt: new Date() }),
      updateMany: async (args) => { calls.push(["match-claim", args]); return { count: 1 }; },
    },
    user: { findUnique: async () => ({ identityVerification: "VERIFIED", providerRoleStatus: "ACTIVE", providerProfile: { hourlyRate: 250, assessmentFee: 30, assessmentRequired: true } }) },
    providerSkill: { findFirst: async () => ({ id: "skill-1", hourlyRate: 350, assessmentFee: 30, assessmentRequired: true }) },
    providerResponse: { create: async (args) => { calls.push(["offer", args]); return { id: "offer-1", status: "OFFERED" }; } },
    appNotification: { create: async (args) => { calls.push(["seeker-notification", args]); } },
  };
  const result = await serviceWith(tx).respondToRequest("provider-1", "request-1");
  assert.deepEqual(result, { id: "offer-1", status: "OFFERED" });
  assert.equal(calls[0], "request-lock");
  assert.deepEqual(calls.find((item) => Array.isArray(item) && item[0] === "match-claim")[1], {
    where: { id: "match-1", requestId: "request-1", providerId: "provider-1", status: "NOTIFIED" },
    data: { status: "RESPONDED" },
  });
  assert.equal(calls.findIndex((item) => Array.isArray(item) && item[0] === "match-claim")
    < calls.findIndex((item) => Array.isArray(item) && item[0] === "offer"), true);
  const offerData = calls.find((item) => Array.isArray(item) && item[0] === "offer")[1].data;
  assert.equal(offerData.hourlyRateAtOffer, 350, "The offer must use the requested skill rate, not the legacy Provider-wide rate.");
  assert.equal(offerData.assessmentFeeAtOffer, 30);
  assert.equal(offerData.assessmentRequiredAtOffer, true);
  assert.equal(offerData.message, null);
  assert.equal(calls.find((item) => Array.isArray(item) && item[0] === "seeker-notification")[1].data.data.responseId, "offer-1");
});

test("Provider acceptance builds a no-assessment offer from that skill's saved settings", async () => {
  const calls = [];
  const tx = {
    $queryRaw: async () => [],
    serviceRequest: {
      findUnique: async () => ({ id: "request-1", seekerId: "seeker-1", skillCategory: "Plumber", status: "OPEN" }),
      updateMany: async () => ({ count: 1 }),
    },
    requestMatch: {
      findUnique: async () => ({ id: "match-1", status: "NOTIFIED", notifiedAt: new Date() }),
      updateMany: async () => ({ count: 1 }),
    },
    user: { findUnique: async () => ({ identityVerification: "VERIFIED", providerRoleStatus: "ACTIVE", providerProfile: { assessmentFee: 0, assessmentRequired: false } }) },
    providerSkill: { findFirst: async () => ({ id: "skill-1", hourlyRate: 425, assessmentFee: 0, assessmentRequired: false }) },
    providerResponse: { create: async (args) => { calls.push(args); return { id: "offer-1", status: "OFFERED" }; } },
    appNotification: { create: async () => {} },
  };
  const result = await serviceWith(tx).respondToRequest("provider-1", "request-1");
  assert.deepEqual(result, { id: "offer-1", status: "OFFERED" });
  assert.deepEqual(calls[0].data, {
    requestId: "request-1",
    providerId: "provider-1",
    message: null,
    status: "OFFERED",
    hourlyRateAtOffer: 425,
    assessmentFeeAtOffer: 0,
    assessmentRequiredAtOffer: false,
  });
});


test("Provider can require a free assessment when accepting a request", async () => {
  const calls = [];
  const tx = {
    $queryRaw: async () => [],
    serviceRequest: {
      findUnique: async () => ({ id: "request-1", seekerId: "seeker-1", skillCategory: "Plumber", status: "OPEN" }),
      updateMany: async () => ({ count: 1 }),
    },
    requestMatch: {
      findUnique: async () => ({ id: "match-1", status: "NOTIFIED", notifiedAt: new Date() }),
      updateMany: async () => ({ count: 1 }),
    },
    user: { findUnique: async () => ({ identityVerification: "VERIFIED", providerRoleStatus: "ACTIVE", providerProfile: { assessmentFee: 0, assessmentRequired: true } }) },
    providerSkill: { findFirst: async () => ({ id: "skill-1", hourlyRate: 425, assessmentFee: 0, assessmentRequired: true }) },
    providerResponse: { create: async (args) => { calls.push(args); return { id: "offer-1", status: "OFFERED" }; } },
    appNotification: { create: async () => {} },
  };
  await serviceWith(tx).respondToRequest("provider-1", "request-1");
  assert.equal(calls[0].data.assessmentRequiredAtOffer, true);
  assert.equal(calls[0].data.assessmentFeeAtOffer, 0);
});

test("Provider acceptance fails closed when the match compare-and-set loses a race", async () => {
  let offerCreated = false;
  const tx = {
    $queryRaw: async () => [],
    serviceRequest: { findUnique: async () => ({ id: "request-1", seekerId: "seeker-1", skillCategory: "Plumber", status: "OPEN" }) },
    requestMatch: {
      findUnique: async () => ({ id: "match-1", status: "NOTIFIED", notifiedAt: new Date() }),
      updateMany: async () => ({ count: 0 }),
    },
    user: { findUnique: async () => ({ identityVerification: "VERIFIED", providerRoleStatus: "ACTIVE", providerProfile: { hourlyRate: 250 } }) },
    providerSkill: { findFirst: async () => ({ id: "skill-1", hourlyRate: 250 }) },
    providerResponse: { create: async () => { offerCreated = true; } },
  };
  await assert.rejects(
    serviceWith(tx).respondToRequest("provider-1", "request-1"),
    (error) => error.getStatus?.() === 409,
  );
  assert.equal(offerCreated, false);
});

test("Seeker selection rejects a Provider whose identity, account, or requested skill is no longer approved", async () => {
  for (const provider of [
    { identityVerification: "PENDING", providerRoleStatus: "ACTIVE" },
    { identityVerification: "VERIFIED", providerRoleStatus: "SUSPENDED" },
  ]) {
    let requestClosed = false;
    const tx = {
      $queryRaw: async () => [],
      serviceRequest: { findUnique: async () => ({ id: "request-1", seekerId: "seeker-1", status: "OPEN", title: "Fix a tap", skillCategory: "Plumber" }), updateMany: async () => { requestClosed = true; return { count: 1 }; } },
      providerResponse: { findFirst: async () => ({ id: "offer-1", providerId: "provider-1", hourlyRateAtOffer: 250, assessmentFeeAtOffer: 0 }) },
      user: { findUnique: async () => provider },
      providerSkill: { findFirst: async () => ({ id: "skill-1" }) },
    };
    await assert.rejects(
      serviceWith(tx).selectProvider("seeker-1", "request-1", "offer-1"),
      (error) => error.getStatus?.() === 403,
    );
    assert.equal(requestClosed, false);
  }
  let requestClosed = false;
  const tx = {
    $queryRaw: async () => [],
    serviceRequest: { findUnique: async () => ({ id: "request-1", seekerId: "seeker-1", status: "OPEN", title: "Fix a tap", skillCategory: "Plumber" }), updateMany: async () => { requestClosed = true; return { count: 1 }; } },
    providerResponse: { findFirst: async () => ({ id: "offer-1", providerId: "provider-1", hourlyRateAtOffer: 250, assessmentFeeAtOffer: 0 }) },
    user: { findUnique: async () => ({ identityVerification: "VERIFIED", providerRoleStatus: "ACTIVE" }) },
    providerSkill: { findFirst: async () => null },
  };
  await assert.rejects(
    serviceWith(tx).selectProvider("seeker-1", "request-1", "offer-1"),
    (error) => error.getStatus?.() === 403,
  );
  assert.equal(requestClosed, false);
});

test("Seeker selection creates one engagement and notifies only after the exact offer is selected", async () => {
  const calls = [];
  const tx = {
    $queryRaw: async () => { calls.push("request-lock"); return []; },
    serviceRequest: {
      findUnique: async () => ({ id: "request-1", seekerId: "seeker-1", status: "OPEN", title: "Fix a tap", skillCategory: "Plumber" }),
      updateMany: async () => { calls.push("request-close"); return { count: 1 }; },
    },
    providerResponse: {
      findFirst: async () => ({ id: "offer-1", providerId: "provider-1", hourlyRateAtOffer: 250, assessmentFeeAtOffer: 30 }),
      updateMany: async (args) => { calls.push(["offer-update", args]); return { count: 1 }; },
    },
    user: { findUnique: async () => ({ identityVerification: "VERIFIED", providerRoleStatus: "ACTIVE" }) },
    providerSkill: { findFirst: async () => ({ id: "skill-1" }) },
    requestMatch: { updateMany: async () => { calls.push("match-update"); return { count: 1 }; } },
    jobEngagement: { create: async (args) => { calls.push(["job", args]); } },
    appNotification: { create: async (args) => { calls.push(["notification", args]); } },
  };
  const result = await serviceWith(tx).selectProvider("seeker-1", "request-1", "offer-1");
  assert.deepEqual(result, {
    success: true, requestId: "request-1", selectedResponseId: "offer-1",
    selectedProviderId: "provider-1", status: "ASSESSMENT_PENDING",
  });
  assert.deepEqual(calls.find((item) => Array.isArray(item) && item[0] === "offer-update")[1], {
    where: { id: "offer-1", requestId: "request-1", providerId: "provider-1", status: "OFFERED" },
    data: { status: "SELECTED" },
  });
  const jobIndex = calls.findIndex((item) => Array.isArray(item) && item[0] === "job");
  const notificationIndices = calls.map((item, index) => Array.isArray(item) && item[0] === "notification" ? index : -1).filter((index) => index >= 0);
  assert.equal(jobIndex > calls.indexOf("request-close"), true);
  assert.equal(notificationIndices.length, 2);
  assert.ok(notificationIndices.every((index) => index > jobIndex));
  assert.equal(calls.find((item) => Array.isArray(item) && item[0] === "job")[1].data.hourlyRate, 250);
});

test("no-assessment hourly jobs reject all additional-hours requests", async () => {
  const job = { id: "job-1", providerId: "provider-1", status: "IN_PROGRESS", assessmentRequired: false, workSegmentStartedAt: new Date(), workPausedAt: null, workAccumulatedMs: 0 };
  const tx = {
    $queryRaw: async () => [],
    jobEngagement: { findUnique: async () => job },
    jobCostAdjustment: { count: async () => 0, create: async () => { throw new Error("An adjustment must not be created"); } },
  };
  await assert.rejects(
    serviceWith(tx).requestAdditionalHours("provider-1", "request-1", { additionalHours: 1, reason: "The work is taking longer than expected" }),
    (error) => error.getStatus?.() === 409 && /capped at one billable hour/i.test(error.message),
  );
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


test("estimate submission uses a conditional state transition and rejects a stale concurrent submit", async () => {
  const calls = [];
  const tx = {
    jobEngagement: {
      findUnique: async () => ({ id: "job-1", requestId: "request-1", providerId: "provider-1", seekerId: "seeker-1", status: "ASSESSMENT_PENDING", hourlyRate: 250, assessmentCompletedAt: new Date() }),
      updateMany: async (args) => { calls.push(args); return { count: 0 }; },
    },
    appNotification: { create: async () => { throw new Error("must not notify after a failed claim"); } },
  };
  await assert.rejects(
    serviceWith(tx).submitEstimate("provider-1", "request-1", { estimatedHours: 2, notes: "Two hours to complete the repair." }),
    (error) => error.getStatus?.() === 409,
  );
  assert.deepEqual(calls[0].where, { id: "job-1", providerId: "provider-1", status: "ASSESSMENT_PENDING" });
});

test("estimate decision is single-winner and cannot be reversed by a stale second decision", async () => {
  const calls = [];
  let notifications = 0;
  const tx = {
    jobEngagement: {
      findUnique: async () => ({ id: "job-1", requestId: "request-1", providerId: "provider-1", seekerId: "seeker-1", status: "ESTIMATE_SUBMITTED" }),
      updateMany: async (args) => { calls.push(args); return { count: 0 }; },
    },
    appNotification: { create: async () => { notifications += 1; } },
  };
  await assert.rejects(
    serviceWith(tx).decideEstimate("seeker-1", "request-1", { approved: false, note: "Please clarify the materials and labour." }),
    (error) => error.getStatus?.() === 409,
  );
  assert.deepEqual(calls[0].where, { id: "job-1", seekerId: "seeker-1", status: "ESTIMATE_SUBMITTED" });
  assert.equal(notifications, 0);
});


test("additional-hours decision cannot overwrite a decision committed by another client", async () => {
  const calls = [];
  let notifications = 0;
  const tx = {
    jobEngagement: { findUnique: async () => ({ id: "job-1", providerId: "provider-1", seekerId: "seeker-1", status: "IN_PROGRESS", workPausedAt: new Date(), workSegmentStartedAt: null }) },
    jobCostAdjustment: {
      findFirst: async () => ({ id: "adjustment-1", engagementId: "job-1", status: "PENDING" }),
      updateMany: async (args) => { calls.push(args); return { count: 0 }; },
    },
    appNotification: { create: async () => { notifications += 1; } },
  };
  await assert.rejects(
    serviceWith(tx).decideAdditionalHours("seeker-1", "request-1", "adjustment-1", { approved: true }),
    (error) => error.getStatus?.() === 409,
  );
  assert.deepEqual(calls[0].where, { id: "adjustment-1", engagementId: "job-1", status: "PENDING" });
  assert.equal(notifications, 0);
});

test("completion review cannot overwrite a completion decision already committed elsewhere", async () => {
  const calls = [];
  let jobChanged = false;
  let notifications = 0;
  const tx = {
    jobEngagement: {
      findUnique: async () => ({ id: "job-1", providerId: "provider-1", seekerId: "seeker-1", status: "COMPLETION_PENDING" }),
      updateMany: async () => { jobChanged = true; return { count: 1 }; },
    },
    jobCompletionSubmission: {
      findFirst: async () => ({ id: "submission-1", engagementId: "job-1", status: "PENDING" }),
      updateMany: async (args) => { calls.push(args); return { count: 0 }; },
    },
    appNotification: { create: async () => { notifications += 1; } },
  };
  await assert.rejects(
    serviceWith(tx).decideJobCompletion("seeker-1", "request-1", "submission-1", { approved: true }),
    (error) => error.getStatus?.() === 409,
  );
  assert.deepEqual(calls[0].where, { id: "submission-1", engagementId: "job-1", status: "PENDING" });
  assert.equal(jobChanged, false);
  assert.equal(notifications, 0);
});


test("additional-hours request atomically stops billable time while awaiting Seeker approval", async () => {
  const startedAt = new Date(Date.now() - 5_000);
  const calls = [];
  const job = { id: "job-1", requestId: "request-1", providerId: "provider-1", seekerId: "seeker-1", status: "IN_PROGRESS", workAccumulatedMs: 2_000, workSegmentStartedAt: startedAt, workPausedAt: null, hourlyRate: 250 };
  const tx = {
    $queryRaw: async () => [],
    jobEngagement: { findUnique: async () => job, updateMany: async (args) => { calls.push(args); return { count: 1 }; } },
    jobCostAdjustment: { count: async () => 0, create: async ({data}) => ({id:"adjustment-1",status:"PENDING",...data}) },
    appNotification: { create: async () => {} },
  };
  const result = await serviceWith(tx).requestAdditionalHours("provider-1", "request-1", {additionalHours:1,reason:"Unexpected extra work discovered"});
  assert.equal(calls[0].data.workSegmentStartedAt, null);
  assert.ok(calls[0].data.workPausedAt instanceof Date);
  assert.ok(calls[0].data.workAccumulatedMs >= 7_000);
  assert.equal(result.status, "PENDING");
});

test("additional-hours decision does not restart the timer automatically", async () => {
  const calls = [];
  const job = {id:"job-1",providerId:"provider-1",seekerId:"seeker-1",status:"IN_PROGRESS",workPausedAt:new Date(),workSegmentStartedAt:null};
  const adjustment = {id:"adjustment-1",engagementId:"job-1",status:"PENDING"};
  const tx = {
    jobEngagement: {findUnique:async()=>job},
    jobCostAdjustment: {findFirst:async()=>adjustment,updateMany:async(args)=>{calls.push(args);return {count:1};},findUniqueOrThrow:async()=>({...adjustment,status:"APPROVED"})},
    appNotification:{create:async()=>{}},
  };
  const result = await serviceWith(tx).decideAdditionalHours("seeker-1","request-1","adjustment-1",{approved:true});
  assert.equal(result.resumeRequired,true);
  assert.equal(result.workPaused,true);
  assert.equal(calls.length,1);
});

test("completion rejection leaves the timer paused until the Provider explicitly resumes", async () => {
  const job = {id:"job-1",seekerId:"seeker-1",providerId:"provider-1",status:"COMPLETION_PENDING"};
  const submission = {id:"submission-1",status:"PENDING"};
  const calls = [];
  const tx = {
    jobEngagement:{findUnique:async()=>job,updateMany:async(args)=>{calls.push(args);return {count:1};}},
    jobCompletionSubmission:{findFirst:async()=>submission,updateMany:async()=>({count:1}),findUniqueOrThrow:async()=>({...submission,status:"REJECTED"})},
    jobCostAdjustment:{aggregate:async()=>({_sum:{requestedAmount:null}})},
    appNotification:{create:async()=>{}},
  };
  const result = await serviceWith(tx).decideJobCompletion("seeker-1","request-1","submission-1",{approved:false,note:"The repair is incomplete and still leaking."});
  assert.equal(result.jobStatus,"IN_PROGRESS");
  assert.equal(calls[0].data.workSegmentStartedAt,null);
  assert.ok(calls[0].data.workPausedAt instanceof Date);
});



test("Seeker final approval snapshots estimate, assessment fee and approved extras exactly once", async () => {
  const calls = [];
  const job = {id:"job-1",seekerId:"seeker-1",providerId:"provider-1",status:"COMPLETION_PENDING",estimatedTotal:"500.00",assessmentFee:"75.00"};
  const submission = {id:"submission-1",status:"PENDING"};
  const tx = {
    jobEngagement:{findUnique:async()=>job,updateMany:async(args)=>{calls.push(args);return {count:1};}},
    jobCompletionSubmission:{findFirst:async()=>submission,updateMany:async()=>({count:1}),findUniqueOrThrow:async()=>({...submission,status:"APPROVED"})},
    jobCostAdjustment:{aggregate:async()=>({_sum:{requestedAmount:"125.00"}})},
    jobFinancialTransaction:{createMany:async({data})=>{calls.push({ledger:data});}},
    serviceRequest:{updateMany:async()=>({count:1})},
    appNotification:{createMany:async({data})=>{calls.push({notifications:data});}},
  };
  const result = await serviceWith(tx).decideJobCompletion("seeker-1","request-1","submission-1",{approved:true});
  assert.equal(result.jobStatus,"COMPLETED");
  assert.equal(result.finalAmountDue,"700.00");
  assert.equal(result.nextStep,"RATINGS");
  assert.equal(result.paymentStatus,"UNPAID");
  assert.equal(result.successfulDebit,false);
  assert.equal(result.providerPayoutStatus,"NOT_SENT");
  assert.equal(result.providerPayoutAmount,"630.00");
  assert.equal(result.platformCommissionAmount,"70.00");
  assert.equal(calls[0].where.finalAmountDue,null);
  assert.equal(calls[0].data.finalAmountDue.toFixed(2),"700.00");
  assert.equal(calls[0].data.finalApprovedAt instanceof Date,true);
  assert.deepEqual(calls.find((call)=>call.ledger)?.ledger.map((entry)=>entry.transactionType),["SEEKER_PAYMENT","PROVIDER_PAYOUT","PLATFORM_COMMISSION"]);
  assert.deepEqual(calls.find((call)=>call.ledger)?.ledger.map((entry)=>entry.amount.toFixed(2)),["700.00","630.00","70.00"]);
  assert.deepEqual(calls.find((call)=>call.ledger)?.ledger.map((entry)=>entry.status),["PENDING","PENDING","PENDING"]);
});

test("opening a dispute pauses the job and notifies the other party", async () => {
  const calls = [];
  const job = {id:"job-1",seekerId:"seeker-1",providerId:"provider-1",status:"COMPLETION_PENDING",requestId:"request-1"};
  const tx = {
    $queryRaw:async()=>[],
    jobEngagement:{findUnique:async()=>job,updateMany:async(args)=>{calls.push(["job",args]);return {count:1};}},
    jobCompletionSubmission:{findFirst:async()=>({id:"submission-1"})},
    jobDispute:{findFirst:async()=>null,create:async({data})=>({id:"dispute-1",...data})},
    appNotification:{create:async(args)=>calls.push(["notification",args])},
  };
  const result = await serviceWith(tx).openJobDispute("seeker-1","request-1",{reason:"The completed work does not match the approved estimate or agreed scope."});
  assert.equal(result.id,"dispute-1");
  assert.equal(calls[0][1].data.status,"DISPUTED");
  assert.equal(calls[0][1].data.workSegmentStartedAt,null);
  assert.equal(calls[1][1].data.userId,"provider-1");
});

test("staff dispute resolution records the decision and keeps the timer paused for corrective work", async () => {
  const calls = [];
  const dispute = {id:"dispute-1",engagementId:"job-1",status:"OPEN",engagement:{id:"job-1",requestId:"request-1",seekerId:"seeker-1",providerId:"provider-1"}};
  const tx = {
    $queryRaw:async()=>[],
    jobDispute:{findUnique:async()=>dispute,updateMany:async(args)=>{calls.push(["dispute",args]);return {count:1};}},
    jobCompletionSubmission:{findFirst:async()=>({id:"submission-1"}),updateMany:async(args)=>calls.push(["submission",args])},
    jobEngagement:{updateMany:async(args)=>{calls.push(["job",args]);return {count:1};}},
    serviceRequest:{updateMany:async(args)=>calls.push(["request",args])},
    appNotification:{createMany:async(args)=>calls.push(["notifications",args])},
    staffAuditLog:{create:async(args)=>calls.push(["audit",args])},
  };
  const result = await serviceWith(tx).resolveJobDispute("staff-1","dispute-1",{outcome:"SEEKER",note:"Provider must return and correct the incomplete repair before closure."});
  assert.equal(result.jobStatus,"IN_PROGRESS");
  assert.equal(calls.find(([name])=>name==="job")[1].data.workSegmentStartedAt,null);
  assert.ok(calls.find(([name])=>name==="job")[1].data.workPausedAt instanceof Date);
  assert.equal(calls.some(([name])=>name==="request"),false);
  assert.equal(calls.find(([name])=>name==="audit")[1].data.action,"JOB_DISPUTE_RESOLVED");
});

test("matching uses approved ProviderSkill records even when the profile skill cache is stale", async () => {
  const prisma = {
    providerProfile: {
      findMany: async () => [{
        userId: "provider-1",
        // Simulate a legacy/stale denormalized profile that omitted Plumbing.
        skillCategories: [],
        deliveryModes: ["REMOTE"],
        maxTravelDistanceKm: 25,
        liveLatitude: null,
        liveLongitude: null,
        liveAccuracyM: null,
        liveLocationUpdatedAt: null,
        user: {
          onboardingDraft: null,
          providerSkills: [{ category: "plumber" }],
        },
      }],
    },
    jobEngagement: { groupBy: async () => [] },
    providerReview: { groupBy: async () => [] },
  };
  const service = new MarketplaceService(prisma, {});
  const ranked = await service.rankedProviders({
    id: "request-1",
    seekerId: "seeker-1",
    skillCategory: "plumber",
    location: null,
    latitude: null,
    longitude: null,
    searchRadiusKm: 10,
    deliveryMode: "REMOTE",
  });

  assert.deepEqual(ranked, [{ userId: "provider-1", score: 7000 }]);
});


test("Provider going online immediately retries recent open requests for an approved skill", async () => {
  const calls = [];
  const prisma = {
    user: {
      findUnique: async () => ({
        providerRoleStatus: "ACTIVE",
        identityVerification: "VERIFIED",
      }),
    },
    providerProfile: {
      upsert: async () => ({ isAvailable: true }),
    },
    providerSkill: {
      findMany: async (args) => {
        calls.push(["approved-skills", args]);
        return [{ category: "Plumber", hourlyRate: 250 }];
      },
    },
    serviceRequest: {
      findMany: async (args) => {
        calls.push(["open-requests", args]);
        return [{ id: "request-1", matchingWave: 0 }];
      },
    },
  };
  const service = new MarketplaceService(prisma, { notifyChanged() {} });
  service.dispatchNextWave = async (...args) => {
    calls.push(["dispatch", args]);
    return { notified: 1, wave: 1 };
  };

  await service.updateProviderProfile("provider-1", {
    publicName: "Available Plumber",
    hourlyRate: 250,
    assessmentFee: 0,
    skillCategories: ["Plumber"],
    serviceAreas: ["Johannesburg"],
    deliveryModes: ["REMOTE"],
    isAvailable: true,
    latitude: -26.2,
    longitude: 28.0,
    accuracyM: 10,
  });

  const skillQuery = calls.find(([name]) => name === "approved-skills")[1];
  assert.deepEqual(skillQuery.where, { userId: "provider-1", status: "APPROVED", isPaused: false });
  const requestQuery = calls.find(([name]) => name === "open-requests")[1];
  assert.equal(requestQuery.where.status, "OPEN");
  assert.deepEqual(requestQuery.where.skillCategory, { in: ["Plumber"], mode: "insensitive" });
  assert.equal(requestQuery.where.matchingStartedAt.gt instanceof Date, true);
  assert.deepEqual(requestQuery.where.OR, [
    { matchingExhaustedAt: { not: null } },
    { matchingNextAt: { lte: requestQuery.where.OR[1].matchingNextAt.lte } },
  ]);
  assert.deepEqual(calls.find(([name]) => name === "dispatch")[1], ["request-1", 1]);
});


test("Provider offer review lists only the current Provider open offers", async () => {
  const expected = [{ id: "offer-1", requestId: "request-1", status: "OFFERED" }];
  const prisma = { providerResponse: { findMany: async (args) => {
    assert.deepEqual(args.where, { providerId: "provider-1", status: "OFFERED", request: { status: "OPEN" } });
    assert.deepEqual(args.orderBy, { createdAt: "desc" });
    return expected;
  } } };
  const service = new MarketplaceService(prisma, {});
  assert.deepEqual(await service.listMyOffers("provider-1"), expected);
});
