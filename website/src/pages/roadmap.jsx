import React, { useState } from "react";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import Translate, { translate } from "@docusaurus/Translate";
import Fonts from "../components/landing/Fonts";
import { roadmapAreas, roadmapItems, roadmapStatuses } from "../components/landing/roadmap";
import styles from "../components/landing/landing.module.css";

export default function Roadmap() {
  const items = roadmapItems();
  const areas = roadmapAreas();
  const used = Object.keys(areas).filter((a) => items.some((i) => i.area === a));
  const [area, setArea] = useState("all");
  const why = translate({ id: "roadmap.why", message: "Why it matters:" });

  return (
    <Layout
      title={translate({ id: "roadmap.meta.title", message: "Roadmap" })}
      description={translate({
        id: "roadmap.meta.description",
        message: "What the sideagent team plans to build next, and what is available today.",
      })}
    >
      <Fonts />
      <main className={styles.root}>
        <div className={styles.wrap}>
          <section className={styles.rmHero}>
            <Link className={styles.back} to="/">
              <span aria-hidden="true">←</span> <Translate id="roadmap.back">Back to overview</Translate>
            </Link>
            <h1>
              <Translate id="roadmap.title">Roadmap</Translate>
            </h1>
            <p>
              <Translate id="roadmap.lede">
                What we plan to build, in the order we expect to build it. There are no dates, and the order can change.
              </Translate>
            </p>
            <div
              className={styles.filters}
              role="group"
              aria-label={translate({ id: "roadmap.filter.label", message: "Filter by area" })}
            >
              {["all", ...used].map((a) => (
                <button
                  key={a}
                  type="button"
                  className={styles.chip}
                  aria-pressed={area === a}
                  onClick={() => setArea(a)}
                >
                  {a === "all" ? translate({ id: "roadmap.filter.all", message: "All" }) : areas[a]}
                </button>
              ))}
            </div>
          </section>

          {roadmapStatuses().map((st) => {
            const list = items.filter((i) => i.status === st.key && (area === "all" || i.area === area));
            return (
              <section className={styles.rmGroup} key={st.key}>
                <div className={styles.rmGroupHead}>
                  <h2>{st.title}</h2>
                  <p>{st.note}</p>
                </div>
                <div className={styles.rmList}>
                  {list.length ? (
                    list.map((i) => (
                      <article className={styles.rmItem} key={i.title}>
                        <span className={styles.area}>{areas[i.area]}</span>
                        <h3>{i.title}</h3>
                        <p>{i.body}</p>
                        {i.why && (
                          <p className={styles.why}>
                            <b>{why}</b> {i.why}
                          </p>
                        )}
                      </article>
                    ))
                  ) : (
                    <p className={styles.rmEmpty}>
                      <Translate id="roadmap.empty">Nothing in this area yet.</Translate>
                    </p>
                  )}
                </div>
              </section>
            );
          })}

          <div className={styles.rmFoot}>
            <p>
              <Translate id="roadmap.foot">Missing something your team needs? Open an issue on GitHub.</Translate>
            </p>
            <Link className={`${styles.btn} ${styles.btnSecondary}`} href="https://github.com/egig/sideagent/issues">
              <Translate id="roadmap.issue">Open an issue</Translate>
            </Link>
          </div>
        </div>
      </main>
    </Layout>
  );
}
