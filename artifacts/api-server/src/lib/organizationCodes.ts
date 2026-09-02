export function derivePrefix(name: string): string | null {
  const tokens = name.split(/\s+/).map((token) => token.replace(/[^A-Za-z]/g, "")).filter((token) => token.length > 0);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return tokens[0].slice(0, 3).toUpperCase();
  return tokens.map((token) => token[0]).join("").slice(0, 4).toUpperCase();
}

// `taken` holds upper-cased prefixes already used by this owner.
export function uniquePrefix(base: string | null, taken: Set<string>): string {
  if (base && !taken.has(base)) return base;
  if (base) {
    for (let i = 2; ; i += 1) {
      const candidate = `${base}${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
  for (let i = 1; ; i += 1) {
    const candidate = `ORG${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function organizationCode(prefix: string): string {
  return `${prefix}.000`;
}

// `taken` holds the numeric suffixes already used by that organization's branches.
export function branchCode(prefix: string, taken: Set<number>): string {
  let n = 1;
  while (taken.has(n)) n += 1;
  return `${prefix}.${String(n).padStart(3, "0")}`;
}

export function prefixOf(code: string): string {
  const separator = code.indexOf(".");
  return (separator === -1 ? code : code.slice(0, separator)).toUpperCase();
}

export const CODE_PATTERN = /^[A-Za-z0-9]+\.\d{3,}$/;
