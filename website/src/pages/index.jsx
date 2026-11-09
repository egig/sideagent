import React from "react";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import Translate, { translate } from "@docusaurus/Translate";
import ChatDemo from "../components/landing/ChatDemo";
import Fonts from "../components/landing/Fonts";
import { roadmapItems } from "../components/landing/roadmap";
import styles from "../components/landing/landing.module.css";

function Check() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.wrap}>
        <div>
          <h1>
            <Translate id="landing.hero.title">Your help centre, answering inside your app.</Translate>
          </h1>
          <p className={styles.lede}>
            <Translate id="landing.hero.lede">
              sideagent adds an assistant to your product that answers from your own help centre. Every answer shows its
              source, and questions your docs do not cover are declined.
            </Translate>
          </p>
          <div className={styles.ctaRow}>
            <Link className={`${styles.btn} ${styles.btnPrimary}`} to="/docs/quickstart">
              <Translate id="landing.hero.start">Get started</Translate>
            </Link>
            <Link className={`${styles.btn} ${styles.btnSecondary}`} href="https://github.com/egig/sideagent">
              <Translate id="landing.hero.github">View on GitHub</Translate>
            </Link>
          </div>
          <p className={styles.fine}>
            <Translate id="landing.hero.fine" values={{ command: <code>npm i sideagent</code> }}>
              {"Open source under MIT. Install it with {command}."}
            </Translate>
          </p>
        </div>
        <ChatDemo />
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className={`${styles.band} ${styles.grey} ${styles.tight}`}>
      <div className={`${styles.wrap} ${styles.problem}`}>
        <h2>
          <Translate id="landing.problem.title">
            Your users ask support what your help centre already explains.
          </Translate>
        </h2>
        <div>
          <p>
            <Translate id="landing.problem.p1">
              Each of those questions costs an agent's time and a user's patience. The answer exists, but it sits on a
              page the user never opened.
            </Translate>
          </p>
          <p>
            <Translate id="landing.problem.p2">
              sideagent brings that page into the screen where the question comes up.
            </Translate>
          </p>
        </div>
      </div>
    </section>
  );
}

const SERVER_CODE = (
  <pre className={styles.code}>
    <span className={styles.k}>import</span> {"{ createServer }"} <span className={styles.k}>from</span>{" "}
    <span className={styles.s}>"sideagent/server/node"</span>;{"\n\n"}
    <span className={styles.k}>const</span> server = createServer{"({\n"}
    {"  database: process.env.DATABASE_URL,\n"}
    {"  publicUrl: "}
    <span className={styles.s}>"https://agent.example.com"</span>,{"\n"}
    {"  secret: process.env.SIDEAGENT_SECRET,\n});\n"}
    <span className={styles.k}>await</span> server.listen(8788);
  </pre>
);

const CHAT_CODE = (
  <pre className={styles.code}>
    <span className={styles.k}>import</span> {"{ AgentChat }"} <span className={styles.k}>from</span>{" "}
    <span className={styles.s}>"sideagent"</span>;{"\n\n<AgentChat\n  publishableKey="}
    <span className={styles.s}>"pk_…"</span>
    {"\n  getToken={() => auth.getAccessToken()}\n/>"}
  </pre>
);

function HowItWorks() {
  const step = (n) => translate({ id: "landing.how.step", message: "Step {n}" }, { n });
  return (
    <section className={styles.band} id="how-it-works">
      <div className={styles.wrap}>
        <div className={styles.sectionHead}>
          <h2>
            <Translate id="landing.how.title">Add it to your own stack.</Translate>
          </h2>
          <p>
            <Translate id="landing.how.lede">
              One package holds both halves: a server you mount in your backend, and a React chat for your frontend. No
              training data to prepare. sideagent reads the help centre you already have.
            </Translate>
          </p>
        </div>
        <ol className={styles.steps}>
          <li className={styles.step}>
            <div className={styles.stepText}>
              <div className={styles.stepN}>{step(1)}</div>
              <h3>
                <Translate id="landing.how.install.title">Install the package</Translate>
              </h3>
              <p>
                <Translate id="landing.how.install.body">
                  The same package serves your backend and your frontend.
                </Translate>
              </p>
            </div>
            <pre className={styles.code}>npm i sideagent</pre>
          </li>
          <li className={styles.step}>
            <div className={styles.stepText}>
              <div className={styles.stepN}>{step(2)}</div>
              <h3>
                <Translate id="landing.how.server.title">Mount the server</Translate>
              </h3>
              <p>
                <Translate id="landing.how.server.body" values={{ fetch: <code>server.fetch</code> }}>
                  {
                    "One call gives you the dashboard, its sign-in, the agent endpoints and the audit log. It needs Postgres with pgvector, a public URL and a secret of 32 or more characters. Run it on Node, or mount {fetch} in Hono, Next.js or Cloudflare Workers."
                  }
                </Translate>
              </p>
            </div>
            {SERVER_CODE}
          </li>
          <li className={styles.step}>
            <div className={styles.stepText}>
              <div className={styles.stepN}>{step(3)}</div>
              <h3>
                <Translate id="landing.how.dashboard.title">Set up an agent in the dashboard</Translate>
              </h3>
              <p>
                <Translate id="landing.how.dashboard.body">
                  Add your help-centre URLs or Markdown, choose the model, list the sites allowed to show the chat, and
                  try questions in the preview. Switch the agent to Active and copy its publishable key.
                </Translate>
              </p>
            </div>
            <div className={styles.checklist}>
              <span>
                <Translate id="landing.how.dashboard.knowledge">
                  Knowledge: URLs or Markdown, each shown as Queued, Indexed or Failed
                </Translate>
              </span>
              <span>
                <Translate id="landing.how.dashboard.model">Model and its API key, sealed at rest</Translate>
              </span>
              <span>
                <Translate id="landing.how.dashboard.origins">Allowed origins for the chat</Translate>
              </span>
              <span>
                <Translate id="landing.how.dashboard.active">Preview, then Active</Translate>
              </span>
            </div>
          </li>
          <li className={styles.step}>
            <div className={styles.stepText}>
              <div className={styles.stepN}>{step(4)}</div>
              <h3>
                <Translate id="landing.how.chat.title">Add the chat to your app</Translate>
              </h3>
              <p>
                <Translate id="landing.how.chat.body" values={{ getToken: <code>getToken</code> }}>
                  {
                    "The publishable key is safe in the browser. Pass {getToken} so each conversation belongs to the signed-in user."
                  }
                </Translate>
              </p>
            </div>
            {CHAT_CODE}
          </li>
        </ol>
        <p className={styles.stepsNote}>
          <Translate id="landing.how.cloud">
            On sideagent Cloud, coming soon, steps 1 and 2 are done for you: add your knowledge, set the rules and paste
            the component.
          </Translate>
        </p>
      </div>
    </section>
  );
}

function Security() {
  const items = [
    [
      translate({ id: "landing.security.origin.title", message: "Only sites you list can use the chat" }),
      translate({
        id: "landing.security.origin.body",
        message: "Requests from other origins, or with the wrong method or content type, are refused.",
      }),
    ],
    [
      translate({ id: "landing.security.threads.title", message: "A conversation belongs to its user" }),
      translate({
        id: "landing.security.threads.body",
        message: "One customer cannot open or continue another customer's thread.",
      }),
    ],
    [
      translate({ id: "landing.security.untrusted.title", message: "Docs reach the model as untrusted data" }),
      translate({
        id: "landing.security.untrusted.body",
        message:
          "Instructions hidden in a fetched page are wrapped and labelled as data, which limits prompt injection.",
      }),
    ],
    [
      translate({ id: "landing.security.ssrf.title", message: "Fetched URLs pass an SSRF guard" }),
      translate({
        id: "landing.security.ssrf.body",
        message: "Adding a knowledge URL cannot make the server read your internal network.",
      }),
    ],
    [
      translate({ id: "landing.security.passages.title", message: "Raw passages stay off the browser" }),
      translate({
        id: "landing.security.passages.body",
        message: "Users receive the answer and source titles, not the search results behind them.",
      }),
    ],
    [
      translate({ id: "landing.security.errors.title", message: "Provider errors stay on the server" }),
      translate({
        id: "landing.security.errors.body",
        message: "Users never see a raw model error or provider detail.",
      }),
    ],
    [
      translate({ id: "landing.security.keys.title", message: "Model keys are sealed" }),
      translate({
        id: "landing.security.keys.body",
        message: "Keys are encrypted in the database and never returned by the dashboard.",
      }),
    ],
  ];
  return (
    <section className={`${styles.band} ${styles.grey}`} id="security">
      <div className={styles.wrap}>
        <div className={styles.sectionHead}>
          <h2>
            <Translate id="landing.security.title">Secure by default.</Translate>
          </h2>
          <p>
            <Translate id="landing.security.lede">
              An assistant inside your product speaks for your company. These safeguards are on from the first install,
              with nothing to configure.
            </Translate>
          </p>
        </div>
        <ul className={styles.brief}>
          {items.map(([title, body]) => (
            <li key={title}>
              <b>{title}</b>
              <span>{body}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Benefits() {
  const rows = [
    [
      translate({ id: "landing.benefits.support.title", message: "Fewer repeat questions to support" }),
      translate({
        id: "landing.benefits.support.body",
        message:
          "Users get the answer in the app, at any hour, without opening a ticket. Your team keeps its time for cases that need a person.",
      }),
      translate({ id: "landing.benefits.support.who", message: "Support leads" }),
    ],
    [
      translate({ id: "landing.benefits.check.title", message: "Answers your team can check" }),
      translate({
        id: "landing.benefits.check.body",
        message:
          "Each answer lists the pages it came from. Questions your docs do not cover are declined, so the assistant does not invent prices, policies or features.",
      }),
      translate({ id: "landing.benefits.check.who", message: "Product and docs owners" }),
    ],
    [
      translate({ id: "landing.benefits.review.title", message: "Fewer open questions in security review" }),
      translate({
        id: "landing.benefits.review.body",
        message:
          "The safeguards above are on by default, and the code is open, so your reviewers can check them themselves.",
      }),
      translate({ id: "landing.benefits.review.who", message: "Security and compliance" }),
    ],
    [
      translate({ id: "landing.benefits.users.title", message: "Built for signed-in users" }),
      translate({
        id: "landing.benefits.users.body",
        message:
          "Conversations are tied to each user's session, and history is kept per user, so the assistant fits inside an authenticated app.",
      }),
      translate({ id: "landing.benefits.users.who", message: "Engineering" }),
    ],
    [
      translate({ id: "landing.benefits.data.title", message: "Your data, your model" }),
      translate({
        id: "landing.benefits.data.body",
        message: "Choose the model and pay the provider directly. Self-host when the data must stay on your servers.",
      }),
      translate({ id: "landing.benefits.data.who", message: "Finance and IT" }),
    ],
    [
      translate({ id: "landing.benefits.look.title", message: "Looks like your product" }),
      translate({
        id: "landing.benefits.look.body",
        message:
          "A floating button or a sidebar docked beside your app, light and dark modes, and your own colours and font through CSS variables.",
      }),
      translate({ id: "landing.benefits.look.who", message: "Design" }),
    ],
  ];
  return (
    <section className={styles.band} id="benefits">
      <div className={styles.wrap}>
        <div className={styles.sectionHead}>
          <h2>
            <Translate id="landing.benefits.title">What your business gets.</Translate>
          </h2>
        </div>
        <div className={styles.ledger}>
          {rows.map(([title, body, who]) => (
            <div className={styles.ledgerRow} key={title}>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
              <div className={styles.who}>{who}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Plans() {
  return (
    <section className={`${styles.band} ${styles.grey}`} id="plans">
      <div className={styles.wrap}>
        <div className={styles.sectionHead}>
          <h2>
            <Translate id="landing.plans.title">The same product, run by us or by you.</Translate>
          </h2>
        </div>
        <div className={styles.plans}>
          <article className={styles.plan}>
            <div className={styles.planTop}>
              <h3>Cloud</h3>
              <span className={`${styles.badge} ${styles.bNext}`}>
                <Translate id="landing.plans.cloud.badge">Coming soon</Translate>
              </span>
            </div>
            <p>
              <Translate id="landing.plans.cloud.body">
                We run the server, database and upgrades. You add your docs and paste the component.
              </Translate>
            </p>
            <ul>
              <li>
                <Check />
                <span>
                  <Translate id="landing.plans.cloud.steps">
                    Three steps: add your knowledge, set the rules, paste the component
                  </Translate>
                </span>
              </li>
              <li>
                <Check />
                <span>
                  <Translate id="landing.plans.cloud.dashboard">
                    Dashboard, team sign-in and audit log included
                  </Translate>
                </span>
              </li>
              <li>
                <Check />
                <span>
                  <Translate id="landing.plans.cloud.ops">No server or database to operate</Translate>
                </span>
              </li>
            </ul>
          </article>
          <article className={styles.plan}>
            <div className={styles.planTop}>
              <h3>
                <Translate id="landing.plans.self.title">Self-hosted</Translate>
              </h3>
              <span className={`${styles.badge} ${styles.bLive}`}>
                <Translate id="landing.plans.self.badge">Available now</Translate>
              </span>
            </div>
            <p>
              <Translate id="landing.plans.self.body">
                Run it on your own infrastructure. Free under the MIT licence.
              </Translate>
            </p>
            <ul>
              <li>
                <Check />
                <span>
                  <Translate id="landing.plans.self.runtime">
                    Postgres with pgvector, on Node or Cloudflare Workers
                  </Translate>
                </span>
              </li>
              <li>
                <Check />
                <span>
                  <Translate id="landing.plans.self.mount">
                    Mounts inside your own server: Hono, Next.js or Express
                  </Translate>
                </span>
              </li>
              <li>
                <Check />
                <span>
                  <Translate id="landing.plans.self.same">The same dashboard and security defaults</Translate>
                </span>
              </li>
              <li>
                <Check />
                <span>
                  <Translate id="landing.plans.self.data">
                    Data stays on your servers, apart from the model and embedding providers you choose
                  </Translate>
                </span>
              </li>
            </ul>
            <Link className={`${styles.btn} ${styles.btnSecondary}`} to="/docs/self-hosting">
              <Translate id="landing.plans.self.cta">Read the self-hosting guide</Translate>
            </Link>
          </article>
        </div>
      </div>
    </section>
  );
}

function RoadmapPreview() {
  const next = roadmapItems().filter((i) => i.status === "next");
  return (
    <section className={styles.band} id="roadmap">
      <div className={styles.wrap}>
        <div className={styles.headRow}>
          <div className={styles.sectionHead}>
            <h2>
              <Translate id="landing.roadmap.title">What we are building next.</Translate>
            </h2>
            <p>
              <Translate id="landing.roadmap.lede">
                The first priority is showing you what the assistant saves.
              </Translate>
            </p>
          </div>
          <Link className={styles.seeAll} to="/roadmap">
            <Translate id="landing.roadmap.seeAll">See all</Translate> <span aria-hidden="true">→</span>
          </Link>
        </div>
        <ul className={styles.rmBullets}>
          {next.map((i) => (
            <li key={i.title}>
              <b>{i.title}.</b> {i.body}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <Layout
      title={translate({ id: "landing.meta.title", message: "Docs chat for your app" })}
      description={translate({
        id: "landing.meta.description",
        message:
          "sideagent adds an assistant to your product that answers from your own help centre and shows its sources. Open source under MIT.",
      })}
    >
      <Fonts />
      <main className={styles.root}>
        <Hero />
        <Problem />
        <HowItWorks />
        <Security />
        <Benefits />
        <Plans />
        <RoadmapPreview />
      </main>
    </Layout>
  );
}
