import {
  deleteGalleryTestUsers,
  galleryRunIdEnvironmentVariable,
  getGalleryRunIdentity,
} from './clerk-test-user';

export default async function globalTeardown() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (secretKey && process.env[galleryRunIdEnvironmentVariable]) {
    await deleteGalleryTestUsers(secretKey, getGalleryRunIdentity().email);
  }
}