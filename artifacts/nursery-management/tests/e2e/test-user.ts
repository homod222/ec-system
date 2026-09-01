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
  const phone = `9655${runId.replace(/\D/g, '').slice(0, 7).padEnd(7, '0')}`;
  const password = `E2e!${runId.slice(0, 8)}`;
  return {
    runId,
    phone,
    password,
    email: `gallery-admin+${runId}@example.com`,
    fullName: 'Gallery Admin',
    dataPrefix: `e2e-gallery-${runId}-`,
  };
}

const API_BASE = `http://127.0.0.1:${process.env.E2E_API_PORT || '5180'}`;

/**
 * Provision a test admin user by calling the backend's internal
 * test-seed endpoint or by directly inserting via the sign-in flow.
 *
 * Since we control the backend, we POST to /api/auth/test-seed which
 * creates an admin account with a known password (only available in test mode).
 * If that endpoint doesn't exist, we fall back to the register flow.
 */
export async function provisionGalleryTestUser() {
  const identity = getGalleryRunIdentity();

  // Try the test-seed endpoint first (available when NODE_ENV=test or NODE_ENV=development)
  const seedResponse = await fetch(`${API_BASE}/api/auth/test-seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: identity.phone,
      password: identity.password,
      fullName: identity.fullName,
      email: identity.email,
      role: 'admin',
    }),
  });
  if (seedResponse.ok) return;

  // Fallback: try sign-in (user may already exist from a previous run)
  const signInResponse = await fetch(`${API_BASE}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: identity.phone, password: identity.password }),
  });
  if (signInResponse.ok) return;

  throw new Error(
    `Failed to provision gallery test user (seed: ${seedResponse.status}, sign-in: ${signInResponse.status}). ` +
    'Ensure the backend is running and the /api/auth/test-seed endpoint is available.',
  );
}

/**
 * Sign in as the gallery test user and return the JWT + user info
 * needed to inject into the browser's localStorage.
 */
export async function signInGalleryTestUser(): Promise<{ token: string; user: object }> {
  const identity = getGalleryRunIdentity();
  const response = await fetch(`${API_BASE}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: identity.phone, password: identity.password }),
  });
  if (!response.ok) {
    throw new Error(`Failed to sign in gallery test user (${response.status})`);
  }
  const data = await response.json() as {
    ticket: string;
    accountId?: number;
    fullName?: string;
    role?: string;
    ownerId?: string;
    accountType?: string;
  };
  return {
    token: data.ticket,
    user: {
      id: String(data.accountId ?? '0'),
      firstName: (data.fullName ?? identity.fullName).split(/\s+/u)[0] || 'Gallery',
      role: data.role ?? 'admin',
      ownerId: data.ownerId,
      accountType: data.accountType,
    },
  };
}

export async function deleteGalleryTestUser() {
  const identity = getGalleryRunIdentity();
  // Clean up via test-seed DELETE endpoint
  const response = await fetch(`${API_BASE}/api/auth/test-seed`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: identity.phone }),
  });
  // It's fine if the endpoint doesn't exist or the user is already gone
  if (!response.ok && response.status !== 404) {
    console.warn(`Warning: could not clean up gallery test user (${response.status})`);
  }
}
