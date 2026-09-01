import {
  initializeGalleryRunIdentity,
  provisionGalleryTestUser,
} from './test-user';

export default async function globalSetup() {
  initializeGalleryRunIdentity();
  await provisionGalleryTestUser();
}