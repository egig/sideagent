// The signed-in user's account. Fake data: in a real app this comes from your backend.
export interface Invoice {
  number: string;
  client: string;
  amount: number;
  due: string;
  status: "Paid" | "Sent" | "Overdue" | "Draft";
}

export interface Teammate {
  name: string;
  email: string;
  role: "Owner" | "Admin" | "Member" | "Viewer";
  pending?: boolean;
}

export const account = {
  business: "Northwind Studio",
  user: { id: "usr_demo", name: "Dana Reyes", role: "Owner" as const },
  plan: { name: "Pro", price: 19, seats: 5 },
  paymentMethod: { brand: "Visa", last4: "4242", expires: "08/26" },
  // A failed charge from Ledgerly to this account, for the "why did my payment fail?" question.
  charges: [
    {
      receipt: "RCP-2041",
      date: "2026-11-01",
      amount: 19,
      status: "failed",
      reason: "card_declined",
      retry: "2026-11-04",
    },
    { receipt: "RCP-1987", date: "2026-10-01", amount: 19, status: "paid" },
  ],
};

export const invoices: Invoice[] = [
  { number: "INV-0042", client: "Acme Corp", amount: 1800, due: "2026-11-20", status: "Sent" },
  { number: "INV-0041", client: "Globex", amount: 940, due: "2026-10-28", status: "Overdue" },
  { number: "INV-0040", client: "Initech", amount: 2250, due: "2026-10-15", status: "Paid" },
  { number: "INV-0039", client: "Umbrella", amount: 600, due: "2026-11-30", status: "Draft" },
];

export const team: Teammate[] = [
  { name: "Dana Reyes", email: "dana@northwind.example", role: "Owner" },
  { name: "Sam Okafor", email: "sam@northwind.example", role: "Admin" },
  { name: "Lee Park", email: "lee@northwind.example", role: "Member" },
  { name: "Jo Alvarez", email: "jo@northwind.example", role: "Viewer", pending: true },
];

export const docs = [
  { slug: "getting-started", title: "Getting started" },
  { slug: "creating-invoices", title: "Creating invoices" },
  { slug: "taxes", title: "Taxes" },
  { slug: "payment-methods", title: "Payment methods" },
  { slug: "plans-and-billing", title: "Plans and billing" },
  { slug: "teammates-and-roles", title: "Teammates and roles" },
];

export type Page = { kind: "invoices" } | { kind: "billing" } | { kind: "team" } | { kind: "doc"; slug: string };

/**
 * What the chat knows about the user and the screen. Sent as untrusted page context today (the `context` prop).
 * Only what the question needs: the card is masked and no secret leaves the page.
 */
export function chatContext(page: Page) {
  const seatsUsed = team.length;
  return {
    screen: page.kind === "doc" ? `docs/${page.slug}` : page.kind,
    user: { name: account.user.name, role: account.user.role },
    plan: { name: account.plan.name, seats: account.plan.seats, seatsUsed },
    paymentMethod: `${account.paymentMethod.brand} ending ${account.paymentMethod.last4}, expires ${account.paymentMethod.expires}`,
    recentCharges: account.charges,
    invoices: invoices.map(({ number, client, amount, due, status }) => ({ number, client, amount, due, status })),
    team: team.map(({ name, role, pending }) => ({ name, role, pending: Boolean(pending) })),
  };
}
