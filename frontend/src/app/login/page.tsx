import { redirect } from "next/navigation";

// Sign-in now lives on the home page.
export default function LoginPage() {
  redirect("/");
}
