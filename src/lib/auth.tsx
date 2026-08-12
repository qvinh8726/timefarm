import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

export interface SafeAuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
  user: SafeAuthUser | null;
  offline?: boolean;
  error?: string;
  statusUnavailable?: boolean;
}

interface AuthStore {
  status: AuthStatus;
  isLoading: boolean;
  signIn: (input: { email: string; password: string }) => Promise<AuthStatus>;
  signUp: (input: {
    email: string;
    password: string;
    displayName: string;
  }) => Promise<{ status: AuthStatus; requiresEmailConfirmation: boolean }>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<AuthStatus>;
}

const offlineStatus: AuthStatus = {
  configured: false,
  authenticated: false,
  user: null,
};
const AuthContext = createContext<AuthStore | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>(offlineStatus);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async (): Promise<AuthStatus> => {
    if (!window.worklyDesktop) {
      setStatus(offlineStatus);
      return offlineStatus;
    }
    try {
      const next = (await window.worklyDesktop.getAuthStatus()) as AuthStatus;
      setStatus(next);
      return next;
    } catch (error) {
      const unavailable = {
        ...offlineStatus,
        error:
          error instanceof Error
            ? error.message
            : "Unable to read authentication status.",
        statusUnavailable: true,
      } satisfies AuthStatus;
      setStatus(unavailable);
      throw error;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const bootstrap = window.setTimeout(() => {
      void refresh()
        .catch(() => {
          if (mounted)
            setStatus({
              ...offlineStatus,
              error: "Unable to read authentication status.",
              statusUnavailable: true,
            });
        })
        .finally(() => {
          if (mounted) setIsLoading(false);
        });
    }, 0);
    const unsubscribe = window.worklyDesktop?.onAuthChanged((next) =>
      setStatus(next as AuthStatus),
    );
    return () => {
      mounted = false;
      window.clearTimeout(bootstrap);
      unsubscribe?.();
    };
  }, [refresh]);

  const signIn = useCallback(
    async (input: { email: string; password: string }) => {
      if (!window.worklyDesktop)
        throw new Error(
          "Cloud authentication is only available in the desktop application.",
        );
      const next = (await window.worklyDesktop.signIn(input)) as AuthStatus;
      setStatus(next);
      return next;
    },
    [],
  );

  const signUp = useCallback(
    async (input: { email: string; password: string; displayName: string }) => {
      if (!window.worklyDesktop)
        throw new Error(
          "Cloud authentication is only available in the desktop application.",
        );
      const result = (await window.worklyDesktop.signUp(input)) as {
        status: AuthStatus;
        requiresEmailConfirmation: boolean;
      };
      setStatus(result.status);
      return result;
    },
    [],
  );

  const signInWithGoogle = useCallback(async () => {
    if (!window.worklyDesktop)
      throw new Error(
        "Google sign-in is only available in the desktop application.",
      );
    await window.worklyDesktop.signInWithGoogle();
  }, []);

  const signOut = useCallback(async () => {
    if (!window.worklyDesktop) return;
    const next = (await window.worklyDesktop.signOut()) as AuthStatus;
    setStatus(next);
  }, []);

  const value = useMemo<AuthStore>(
    () => ({
      status,
      isLoading,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      refresh,
    }),
    [status, isLoading, signIn, signUp, signInWithGoogle, signOut, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthStore {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
