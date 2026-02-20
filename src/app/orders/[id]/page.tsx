import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/session";

type OrderPageProps = {
  params: Promise<{ id: string }>;
};

export default async function OrderPage({ params }: OrderPageProps) {
  const session = await getServerSession();
  if (!session) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6">
        <h1 className="text-2xl font-semibold text-slate-900">Login required</h1>
        <p className="mt-2 text-sm text-slate-600">Sign in to view your order receipt.</p>
        <Link href="/login?next=/cart" className="mt-3 inline-block text-sm font-medium text-blue-700">
          Go to login
        </Link>
      </div>
    );
  }

  const resolved = await params;
  const order = await db.order.findUnique({
    where: { id: resolved.id },
    include: {
      buyer: { select: { email: true, name: true } },
      orderItems: {
        include: {
          image: { select: { id: true, title: true, filename: true, previewUrl: true } },
        },
      },
    },
  });
  if (!order) notFound();
  if (session.role !== "ADMIN" && session.email.toLowerCase() !== order.buyer.email.toLowerCase()) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-rose-300 bg-rose-50 p-6">
        <h1 className="text-2xl font-semibold text-rose-900">Access denied</h1>
        <p className="mt-2 text-sm text-rose-800">This order belongs to a different account.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-xs uppercase tracking-wide text-slate-500">License receipt</p>
        <h1 className="text-3xl font-semibold text-slate-900">Order {order.id}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {order.buyer.name} ({order.buyer.email}) · {order.status} · ${order.totalUsd} {order.currency}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Payment: {order.paymentProvider} ({order.paymentReference ?? "n/a"})
        </p>
        {order.status !== "paid" ? (
          <p className="mt-1 text-sm text-amber-700">
            This order is not paid yet. Download links will activate after payment confirmation.
          </p>
        ) : null}
        <div className="mt-3 flex gap-3 text-sm">
          <a href={`/api/orders/${order.id}/license`} className="font-medium text-blue-700 hover:underline">
            Download license receipt
          </a>
          <Link href="/cart" className="font-medium text-blue-700 hover:underline">
            Back to cart
          </Link>
        </div>
      </header>

      <section className="space-y-3">
        {order.orderItems.map((item) => (
          <article
            key={item.id}
            className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4"
          >
            <div>
              <h2 className="font-semibold text-slate-900">{item.image.title}</h2>
              <p className="text-sm text-slate-600">{item.image.filename}</p>
              <p className="text-sm text-slate-600">
                License: {item.licenseCode} · ${item.priceUsd}
              </p>
            </div>
            <a
              href={`/api/download/${item.image.id}?order=${order.id}`}
              className={`rounded-full px-4 py-2 text-xs font-semibold text-white ${
                order.status === "paid" ? "bg-slate-900" : "bg-slate-400 pointer-events-none"
              }`}
            >
              Download
            </a>
          </article>
        ))}
      </section>
    </div>
  );
}
