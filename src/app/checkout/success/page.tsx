import Link from "next/link";
import { CheckoutSuccessClient } from "@/components/CheckoutSuccessClient";

type CheckoutSuccessPageProps = {
  searchParams?: Promise<{ order?: string }>;
};

export default async function CheckoutSuccessPage({ searchParams }: CheckoutSuccessPageProps) {
  const params = await searchParams;
  const orderId = params?.order ?? "";

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6">
      <p className="text-xs uppercase tracking-wide text-slate-500">Checkout</p>
      <h1 className="text-3xl font-semibold text-slate-900">Payment Submitted</h1>
      <p className="mt-2 text-sm text-slate-600">
        We are confirming your payment and license issuance.
      </p>
      {orderId ? (
        <div className="mt-4">
          <CheckoutSuccessClient orderId={orderId} />
        </div>
      ) : (
        <div className="mt-4 text-sm">
          <Link href="/cart" className="font-medium text-blue-700 hover:underline">
            Return to cart
          </Link>
        </div>
      )}
    </div>
  );
}
