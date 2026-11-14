import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createCookieSession,
  type SessionSignal,
} from "@have/shared/auth/session";
import { browserSessionLock } from "@have/shared/auth/browser-lock";
import { advisorApi, type Doctor } from "@have/shared/api/advisor";
import { ApiError } from "@have/shared/api";

function makeSession() {
  const channel =
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel("have:advisor:session");
  const adapt = async (work: ReturnType<typeof advisorApi.refresh>) => {
    const result = await work;
    return { ...result, customer: result.doctor };
  };
  const session = createCookieSession<
    Doctor,
    { mfa_token: string; code: string }
  >(
    {
      login: (data) => adapt(advisorApi.mfa(data)),
      refresh: () => adapt(advisorApi.refresh()),
      logout: advisorApi.logout,
    },
    browserSessionLock("have:advisor:refresh"),
    (event) => channel?.postMessage(event),
  );
  return { session, channel };
}
type Controller = ReturnType<typeof makeSession>["session"];
const Context = createContext<Controller | null>(null);
export function AdvisorSessionProvider({ children }: { children: ReactNode }) {
  const [{ session, channel }] = useState(makeSession);
  useEffect(() => {
    const message = (event: MessageEvent<SessionSignal>) => {
      if (event.data === "signed-in" || event.data === "signed-out")
        session.remote(event.data);
    };
    channel?.addEventListener("message", message);
    void session.restore().catch(() => {});
    return () => {
      channel?.removeEventListener("message", message);
    };
  }, [session, channel]);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
export function useAdvisorSession() {
  const session = useContext(Context)!;
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  async function authorized<T>(
    work: (token: string) => Promise<T>,
    safeRead = false,
  ) {
    try {
      return await session.authorized(work, safeRead);
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 401 ||
          error.status === 403)
      )
        session.invalidate();
      throw error;
    }
  }
  return { ...state, session, authorized };
}
