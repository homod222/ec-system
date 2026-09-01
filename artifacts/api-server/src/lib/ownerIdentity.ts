export function configuredOwnerId() {
  return process.env.PUBLIC_SITE_OWNER_ID?.trim() || null;
}

export function configuredOwnerEmails() {
  return (process.env.PUBLIC_SITE_OWNER_EMAIL ?? "")
    .split(/[;,\n]+/u)
    .map((email) => email.trim().toLowerCase())
    .filter((email, index, all) => email.length > 0 && all.indexOf(email) === index);
}

export function isConfiguredOwner(userId: string, verifiedEmails: string[]) {
  const ownerId = configuredOwnerId();
  if (ownerId && userId === ownerId) return true;
  const ownerEmails = configuredOwnerEmails();
  return ownerEmails.some((email) => verifiedEmails.includes(email));
}