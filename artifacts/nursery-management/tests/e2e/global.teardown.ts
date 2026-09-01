import {
  deleteGalleryTestUser,
  galleryRunIdEnvironmentVariable,
} from './test-user';

export default async function globalTeardown() {
  if (process.env[galleryRunIdEnvironmentVariable]) {
    await deleteGalleryTestUser();
  }
}