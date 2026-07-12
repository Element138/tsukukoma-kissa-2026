import { redirect } from "next/navigation";

export default function LegacyCounterRedirectPage() {
  redirect("/counter");
}
