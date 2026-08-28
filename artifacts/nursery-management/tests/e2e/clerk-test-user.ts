type ClerkUser = { id: string };

export const galleryRunIdEnvironmentVariable = 'GALLERY_E2E_RUN_ID';

export function initializeGalleryRunIdentity() {
  process.env[galleryRunIdEnvironmentVariable] ??= crypto.randomUUID();
  return getGalleryRunIdentity();
}

export function getGalleryRunIdentity() {
  const runId = process.env[galleryRunIdEnvironmentVariable];
  if (!runId) {
    throw new Error(`${galleryRunIdEnvironmentVariable} was not initialized for this Playwright run.`);
  }
  return {
    runId,
    email: `gallery-admin+${runId}@example.com`,
    dataPrefix: `e2e-gallery-${runId}-`,
  };
}

function clerkHeaders(secretKey: string) {
  return {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
  };
}

export async function findGalleryTestUsers(secretKey: string, email: string): Promise<ClerkUser[]> {
  const response = await fetch(
    `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`,
    { headers: clerkHeaders(secretKey) },
  );
  if (!response.ok) throw new Error(`Unable to look up the Clerk gallery test user (${response.status}).`);
  return response.json() as Promise<ClerkUser[]>;
}

export async function provisionGalleryTestUser(secretKey: string, ownerId: string, email: string) {
  const response = await fetch('https://api.clerk.com/v1/users', {
    method: 'POST',
    headers: clerkHeaders(secretKey),
    body: JSON.stringify({
      email_address: [email],
      password: `E2e!${crypto.randomUUID()}aA1`,
      first_name: 'Gallery',
      last_name: 'Admin',
      public_metadata: { role: 'admin', ownerId },
    }),
  });
  if (!response.ok) {
    throw new Error(`Unable to create the Clerk gallery test user (${response.status}).`);
  }
}

export async function deleteGalleryTestUsers(secretKey: string, email: string) {
  const users = await findGalleryTestUsers(secretKey, email);
  await Promise.all(users.map(async (user) => {
    const response = await fetch(`https://api.clerk.com/v1/users/${user.id}`, {
      method: 'DELETE',
      headers: clerkHeaders(secretKey),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Unable to delete the Clerk gallery test user (${response.status}).`);
    }
  }));
}