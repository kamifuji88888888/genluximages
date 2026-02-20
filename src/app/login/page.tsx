import { LoginForm } from "@/components/LoginForm";

type LoginPageProps = {
  searchParams?: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = params?.next || "/";
  return (
    <div className="mx-auto max-w-lg space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-500">Access</p>
        <h1 className="text-3xl font-semibold text-slate-900">Sign in to GENLUX</h1>
      </header>
      <LoginForm nextPath={nextPath} />
    </div>
  );
}
