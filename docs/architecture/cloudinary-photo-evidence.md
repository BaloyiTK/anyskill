# Cloudinary photo evidence

Completion evidence is uploaded as authenticated Cloudinary image assets. The integration uses Cloudinary's dynamic-folder `asset_folder` parameter, so the Cloudinary product environment should use Dynamic Folders mode. The API issues a short-lived upload signature and records a user-owned pending asset before the mobile client uploads directly to Cloudinary. The API confirms each upload by querying Cloudinary's authenticated image resource and checking the detected format, byte size and delivery type.

Completion submission accepts asset IDs only. The API attaches only READY, unexpired assets owned by the submitting Provider. Evidence viewing requires the authenticated Seeker or Provider on the associated engagement; the API returns a five-minute private-download URL.

## Configuration

Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in the API deployment environment. Never put the API secret in the mobile app. Run pnpm db:deploy before deploying the API. Rebuild the native mobile app after adding expo-image-picker.

## Limits

JPEG, PNG and WebP only; maximum 10 MB per image and eight images per completion submission. Upload reservations expire after 30 minutes. Existing HTTPS evidence links remain readable for older submissions. Configure operational cleanup for abandoned uploads and define Cloudinary retention and backup policies.

## Verification still required

Configure Cloudinary credentials, deploy the migration, run CI, and test uploads and five-minute evidence access on iOS and Android devices. Huawei Android builds require separate device validation. No credentials or real-device test are included in source control.
