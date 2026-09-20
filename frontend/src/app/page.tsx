import { cookies } from "next/headers";
import Dashboard from "@/components/Dashboard";
import Landing from "@/components/Landing";

// Signed-out visitors get the landing page with sign-in / create account; signed-in users get the
// dashboard. The cookie check is optimistic: the API still verifies the session on every request.
export default async function Home() {
  const signedIn = (await cookies()).has("session");
  return signedIn ? <Dashboard /> : <Landing />;
}
