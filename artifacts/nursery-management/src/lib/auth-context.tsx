import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';

const TOKEN_KEY = 'ec_jwt';
const USER_KEY = 'ec_user';

export interface AuthUser {
  id: string;
  firstName: string;
  role: string;
  ownerId?: string;
  accountType?: string;
}

interface AuthContextValue {
  /** JWT token (null when signed out) */
  token: string | null;
  /** Parsed user info from the last sign-in */
  user: AuthUser | null;
  /** True once the context has finished reading from storage */
  isLoaded: boolean;
  /** Whether a valid token exists */
  isSignedIn: boolean;
  /** Store the JWT + user info and persist to localStorage */
  signIn: (token: string, user: AuthUser) => void;
  /** Clear stored auth state */
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function parseStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedUser = parseStoredUser();
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(storedUser);
    }
    setIsLoaded(true);
  }, []);

  const signIn = useCallback((jwt: string, userInfo: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, jwt);
    localStorage.setItem(USER_KEY, JSON.stringify(userInfo));
    setToken(jwt);
    setUser(userInfo);
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    token,
    user,
    isLoaded,
    isSignedIn: Boolean(token),
    signIn,
    signOut,
  }), [token, user, isLoaded, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

/** Get stored JWT token (for use in API calls outside React) */
export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
