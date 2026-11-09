import { AgentProvider, useAgent } from "sideagent";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { account, chatContext, docs, invoices, team, type Page } from "./data";

// Set in .env.local (VITE_SIDEAGENT_KEY=pk_…) or at build time, or open the app with ?key=pk_… (a publishable key is
// public). Without a key the app runs and the chat is hidden.
const KEY =
  (import.meta.env.VITE_SIDEAGENT_KEY as string | undefined) ||
  new URLSearchParams(location.search).get("key") ||
  undefined;

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function Invoices() {
  return (
    <>
      <h1>Invoices</h1>
      <table>
        <thead>
          <tr>
            <th>Number</th>
            <th>Client</th>
            <th>Amount</th>
            <th>Due</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.number}>
              <td>{i.number}</td>
              <td>{i.client}</td>
              <td>{money(i.amount)}</td>
              <td>{i.due}</td>
              <td>
                <span className={`pill ${i.status.toLowerCase()}`}>{i.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Billing() {
  const { plan, paymentMethod, charges } = account;
  return (
    <>
      <h1>Billing</h1>
      <div className="card">
        <strong>{plan.name} plan</strong> · {money(plan.price)} per month · {plan.seats} seats
      </div>
      <div className="card">
        Payment method: {paymentMethod.brand} ending {paymentMethod.last4} (expires {paymentMethod.expires})
      </div>
      <h2>Receipts</h2>
      <table>
        <tbody>
          {charges.map((c) => (
            <tr key={c.receipt}>
              <td>{c.receipt}</td>
              <td>{c.date}</td>
              <td>{money(c.amount)}</td>
              <td>
                <span className={`pill ${c.status === "failed" ? "overdue" : "paid"}`}>{c.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Team() {
  return (
    <>
      <h1>Team</h1>
      <p>
        {team.length} of {account.plan.seats} seats used.
      </p>
      <table>
        <tbody>
          {team.map((m) => (
            <tr key={m.email}>
              <td>{m.name}</td>
              <td>{m.email}</td>
              <td>{m.role}</td>
              <td>{m.pending ? "Invite pending" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Doc({ slug, go }: { slug: string; go: (page: Page) => void }) {
  const [text, setText] = useState("");
  useEffect(() => {
    let live = true;
    fetch(`/docs/${slug}.md`)
      .then((r) => r.text())
      .then((t) => live && setText(t));
    return () => {
      live = false;
    };
  }, [slug]);
  return (
    <article className="doc">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Links between docs pages (`plans-and-billing.md`) stay in the app.
          a: ({ href = "", children }) =>
            href.endsWith(".md") ? (
              <a
                href={`#${href}`}
                onClick={(e) => {
                  e.preventDefault();
                  go({ kind: "doc", slug: href.replace(/\.md$/, "") });
                }}
              >
                {children}
              </a>
            ) : (
              <a href={href}>{children}</a>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </article>
  );
}

function AskButton() {
  const { open, setOpen, available } = useAgent();
  if (!available) return null;
  return (
    <button className="ask" onClick={() => setOpen(!open)}>
      Ask Ledgerly
    </button>
  );
}

export function App() {
  const [page, setPage] = useState<Page>({ kind: "invoices" });
  const nav = (p: Page, label: string, on: boolean) => (
    <button className={on ? "active" : ""} onClick={() => setPage(p)}>
      {label}
    </button>
  );

  const shell = (
    <div className="shell">
      <aside>
        <div className="brand">Ledgerly</div>
        <div className="group">{account.business}</div>
        {nav({ kind: "invoices" }, "Invoices", page.kind === "invoices")}
        {nav({ kind: "billing" }, "Billing", page.kind === "billing")}
        {nav({ kind: "team" }, "Team", page.kind === "team")}
        <div className="group">Docs</div>
        {docs.map((d) => (
          <div key={d.slug}>
            {nav({ kind: "doc", slug: d.slug }, d.title, page.kind === "doc" && page.slug === d.slug)}
          </div>
        ))}
        <div className="demo">Demo with fake data. Nothing here is real.</div>
      </aside>
      <main>
        <header>
          <span>{account.user.name}</span>
          {KEY && <AskButton />}
        </header>
        {page.kind === "invoices" && <Invoices />}
        {page.kind === "billing" && <Billing />}
        {page.kind === "team" && <Team />}
        {page.kind === "doc" && <Doc slug={page.slug} go={setPage} />}
      </main>
    </div>
  );

  if (!KEY) return <>{shell}</>;
  return (
    <AgentProvider
      publishableKey={KEY}
      mode="sidebar"
      defaultOpen
      launcher={false}
      storageKey={account.user.id}
      context={() => chatContext(page)}
    >
      {shell}
    </AgentProvider>
  );
}
