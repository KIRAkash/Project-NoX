import { redirect } from "next/navigation";

// The reveal now lives at the root — this route stays only so any existing
// links to it still land somewhere.
export default function IntroPage() {
  redirect("/");
}
