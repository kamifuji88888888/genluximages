import Link from "next/link";

type CheckoutCancelPageProps = {
  searchParams?: Promise<{ order?: string }>;
};

export default async function CheckoutCancelPage({ searchParams }: CheckoutCancelPageProps) {
  const params = await searchParams;
  const orderId = params?.order ?? "";

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-amber-300 bg-amber-50 p-6">
      <p className="text-xs uppercase tracking-wide text-amber-800">Checkout canceled</p>
      <h1 className="text-3xl font-semibold text-amber-900">Payment Not Completed</h1>
      <p className="mt-2 text-sm text-amber-900">
        No worries. Your cart is still available and you can retry checkout at any time.
      </p>
      <div className="mt-4 flex gap-3 text-sm">
        <Link href="/cart" className="font-medium text-blue-700 hover:underline">
          Return to cart
        </Link>
        {orderId ? (
          <Link href={`/orders/${orderId}`} className="font-medium text-blue-700 hover:underline">
            View pending order
          </Link>
        ) : null}
      </div>
    </div>
  );
}
