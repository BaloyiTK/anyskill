  }

  private async dispatchPendingNotifications() {
    const pending = await this.prisma.appNotification.findMany({
      where: { deliveryStatus: "PENDING", attempts: { lt: 5 } },
      take: 50,
      orderBy: { createdAt: "asc" },
      select: { id: true, userId: true, title: true, body: true, data: true, attempts: true },
    });
    for (const notification of pending) {
      const devices = await this.prisma.pushDevice.findMany({
        where: { userId: notification.userId },
        select: { id: true, platform: true, expoPushToken: true },
      });
      if (devices.length === 0) {
        await this.prisma.appNotification.updateMany({
          where: { id: notification.id, deliveryStatus: "PENDING" },
          data: { deliveryStatus: "IN_APP_ONLY" },
        });
        continue;
      }
      const claim = await this.prisma.appNotification.updateMany({
        where: { id: notification.id, deliveryStatus: "PENDING" },
        data: { deliveryStatus: "SENDING", attempts: { increment: 1 } },
      });
      if (claim.count === 0) continue;
      try {
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(devices.map((device) => ({
            to: device.expoPushToken,
            title: notification.title,
            body: notification.body,
            data: notification.data ?? {},
            sound: "default",
            priority: "high",
            channelId: (notification.data as { type?: string } | null)?.type === "MATCHED_REQUEST"
              ? "incoming_requests"
              : "default",
            categoryId: (notification.data as { type?: string } | null)?.type === "MATCHED_REQUEST"
              ? "incoming_request"
              : undefined,
          }))),
        });

        // Read the response body once so HTTP-level errors retain Expo's diagnostic
        // details instead of collapsing every rejection into an unhelpful status code.
        const responseText = await response.text();
        let payload: {
          data?: Array<{
            status?: string;
            message?: string;
            details?: { error?: string };
          }>;
          errors?: Array<{
            code?: string;
            message?: string;
            details?: Record<string, unknown>;
          }>;
        } | null = null;
        try {
          payload = responseText ? JSON.parse(responseText) : null;
        } catch {
          // Preserve a bounded, redacted response excerpt in the HTTP error below.
        }

        const redactPushTokens = (value: string) =>
          value.replace(/(?:Expo|Exponent)PushToken\\[[^\\]]+\\]/g, "[redacted Expo push token]");
        if (!response.ok) {
          const details = payload ? JSON.stringify(payload) : responseText || response.statusText;
          // Expo's PUSH_TOO_MANY_EXPERIENCE_IDS response groups tokens by project.
          // Match those tokens in memory so logs identify the affected DB records,
          // while never writing the actual push tokens to logs.
          const projectMappings = payload?.errors?.flatMap((item) => {
            if (!item.details || typeof item.details !== "object") return [];
            return Object.entries(item.details).map(([project, rawTokens]) => {
              const tokens = Array.isArray(rawTokens)
                ? rawTokens.filter((token): token is string => typeof token === "string")
                : [];
              const matchingDevices = devices.filter((device) => tokens.includes(device.expoPushToken));
              const registrations = matchingDevices.length > 0
                ? matchingDevices.map((device) => `${device.id} (${device.platform})`).join(", ")
                : `${tokens.length} token(s) not matched to a registered device`;
              return `${project}: ${registrations}`;
            });
          }) ?? [];
          const mappingMessage = projectMappings.length > 0
            ? ` Device-to-project mapping: ${projectMappings.join("; ")}.`
            : "";
          throw new Error(
            `Expo Push Service returned HTTP ${response.status}: ${redactPushTokens(details).slice(0, 2000)}${mappingMessage}`,
          );
        }
        if (!payload) {
          throw new Error("Expo Push Service returned an empty or invalid JSON response.");
        }

        const tickets = payload.data ?? [];
        if (tickets.length === 0) {
          const details = payload.errors?.map((item) => [item.code, item.message].filter(Boolean).join(": ")).join("; ");
          throw new Error(details || "Expo returned no push delivery tickets.");
        }

        const failedTickets: string[] = [];
        for (const [index, ticket] of tickets.entries()) {
          const device = devices[index];
          if (ticket.status === "ok") continue;

          const errorCode = ticket.details?.error ?? "UnknownExpoError";
          const message = redactPushTokens(ticket.message ?? "No error message returned.").slice(0, 500);
          if (!device) {
            failedTickets.push(`ticket ${index + 1} has no matching registered device (${errorCode})`);
            continue;
          }

          // Never log Expo tokens. Device ID and platform are enough to identify
          // the affected registration without exposing credentials in application logs.
          this.logger.warn(
            `Expo rejected push for device ${device.id} (${device.platform}) for notification ${notification.id}: ${errorCode}: ${message}`,
          );
          failedTickets.push(`${device.id} (${device.platform}): ${errorCode}: ${message}`);

          // Expo marks stale registrations with DeviceNotRegistered. Remove only
          // that specific token so future notifications are not repeatedly rejected.
          if (errorCode === "DeviceNotRegistered") {
            await this.prisma.pushDevice.deleteMany({ where: { id: device.id } });
          }
        }

        if (tickets.length !== devices.length) {
          failedTickets.push(`Expo returned ${tickets.length} ticket(s) for ${devices.length} device(s)`);
        }
        if (failedTickets.length > 0) {
          throw new Error(failedTickets.join("; ").slice(0, 1500));
        }

        // SENT means Expo accepted every push ticket; it is not a confirmation
        // that the operating system displayed the notification.
