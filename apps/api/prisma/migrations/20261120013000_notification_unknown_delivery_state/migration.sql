-- A worker can crash after Expo accepts a push but before its ticket is persisted.
-- UNKNOWN prevents an unsafe automatic resend when delivery cannot be determined.
ALTER TYPE "NotificationDeliveryStatus" ADD VALUE 'UNKNOWN';
