import { clerkSetup } from '@clerk/testing/playwright';
import {
  initializeGalleryRunIdentity,
  provisionGalleryTestUser,
} from './clerk-test-user';

export default async function globalSetup() {
  const identity = initializeGalleryRunIdentity();
  await clerkSetup();
  const secretKey = process.env.CLERK_SECRET_KEY;
  const ownerId = process.env.PUBLIC_SITE_OWNER_ID;
  if (!secretKey || !ownerId) {
    throw new Error('CLERK_SECRET_KEY and PUBLIC_SITE_OWNER_ID are required for the gallery end-to-end test.');
  }
  await provisionGalleryTestUser(secretKey, ownerId, identity.email);
}