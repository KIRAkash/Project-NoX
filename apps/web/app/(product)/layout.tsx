import { AuthProvider } from "@/lib/app/auth";

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="relative min-h-screen overflow-hidden bg-void">
        <div className="starfield opacity-40" aria-hidden />
        <div className="relative">{children}</div>
      </div>
    </AuthProvider>
  );
}
