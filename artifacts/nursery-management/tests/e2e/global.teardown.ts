import { deleteGalleryTestUsers } from './clerk-test-user';

export default async function globalTeardown() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (secretKey) await deleteGalleryTestUsers(secretKey);
}