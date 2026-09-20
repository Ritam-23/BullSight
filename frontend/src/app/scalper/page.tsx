import { redirect } from "next/navigation";

// Default scalping instrument; pick another with the search box on the scalper screen.
export default function ScalperIndex() {
  redirect("/scalper/RELIANCE.NS");
}
