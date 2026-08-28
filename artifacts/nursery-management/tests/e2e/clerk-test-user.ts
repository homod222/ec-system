export const galleryAdminEmail = 'gallery-admin+clerk_test@example.com';

type ClerkUser = { id: string };

function clerkHeaders(secretKey: string) {
  return {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
  };
}

export async function findGalleryTestUsers(secretKey: string): Promise<ClerkUser[]> {
  const response = await fetch(
    `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(galleryAdminEmail)}`,
    { headers: clerkHeaders(secretKey) },
  );
  if (!response.ok) throw new Error(`Unable to look up the Clerk gallery test user (${response.status}).`);
  return response.json() as Promise<ClerkUser[]>;
}

export async function provisionGalleryTestUser(secretKey: string, ownerId: string) {
  const users = await findGalleryTestUsers(secretKey);
  const user = users[0];
  const response = user
    ? await fetch(`https://api.clerk.com/v1/users/${user.id}`, {
        method: 'PATCH',
        headers: clerkHeaders(secretKey),
        body: JSON.stringify({ public_metadata: { role: 'admin', ownerId } }),
      })
    : await fetch('https://api.clerk.com/v1/users', {
        method: 'POST',
        headers: clerkHeaders(secretKey),
        body: JSON.stringify({
          email_address: [galleryAdminEmail],
          password: `E2e!${crypto.randomUUID()}aA1`,
          first_name: 'Gallery',
          last_name: 'Admin',
          public_metadata: { role: 'admin', ownerId },
        }),
      });
  if (!response.ok) {
    throw new Error(`Unable to ${user ? 'update' : 'create'} the Clerk gallery test user (${response.status}).`);
  }
}

export async function deleteGalleryTestUsers(secretKey: string) {
  const users = await findGalleryTestUsers(secretKey);
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