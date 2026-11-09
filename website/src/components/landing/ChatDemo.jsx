import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Translate from "@docusaurus/Translate";
import styles from "./landing.module.css";

// The demo conversation is in Indonesian in every locale: it shows the assistant answering in the user's language.
const Q1 = "Bagaimana cara menambah cabang baru?";
const Q2 = "Siapa juara Piala Dunia 2022?";
const PLACEHOLDER = "Tulis pertanyaan…";
const A1 = [
  ["Buka ", false],
  ["Pengaturan → Cabang", true],
  [", lalu pilih ", false],
  ["Tambah cabang", true],
  [". Isi nama dan alamat, lalu simpan. Stok awal bisa disalin dari cabang yang sudah ada.", false],
];
const A2 = [
  [
    "Saya hanya menjawab pertanyaan tentang produk ini dari panduannya. Coba tanyakan tentang fitur atau pengaturan.",
    false,
  ],
];
const SOURCES = ["Mengelola cabang", "Menyalin stok antar cabang"];

// Splits [text, bold] segments into words, keeping the spaces so the line wraps like normal text.
function words(segments) {
  const out = [];
  for (const [text, bold] of segments) {
    for (const part of text.split(/(\s+)/)) if (part) out.push({ text: part, bold, space: /^\s+$/.test(part) });
  }
  return out;
}
const W1 = words(A1);
const W2 = words(A2);
const count = (ws) => ws.filter((w) => !w.space).length;

const FINAL = {
  input: "",
  typing: false,
  q1: true,
  t1: false,
  a1: count(W1),
  s1: true,
  q2: true,
  t2: false,
  a2: count(W2),
};
const EMPTY = { input: "", typing: false, q1: false, t1: false, a1: -1, s1: false, q2: false, t2: false, a2: -1 };

function Answer({ ws, shown, className }) {
  let n = 0;
  return (
    <span className={className}>
      {ws.map((w, i) => {
        if (w.space) return w.text;
        const on = n++ < shown;
        const cls = `${styles.word} ${on ? styles.wordOn : ""}`;
        return w.bold ? (
          <b key={i} className={cls}>
            {w.text}
          </b>
        ) : (
          <span key={i} className={cls}>
            {w.text}
          </span>
        );
      })}
    </span>
  );
}

export default function ChatDemo() {
  const [s, setS] = useState(FINAL);
  const logRef = useRef(null);
  const visible = useRef(true);

  useLayoutEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [s]);

  useEffect(() => {
    // Reduced motion keeps the finished conversation on screen.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    let alive = true;
    const io =
      "IntersectionObserver" in window
        ? new IntersectionObserver((e) => {
            visible.current = e[0].isIntersecting;
          })
        : null;
    if (io && logRef.current) io.observe(logRef.current);

    const wait = (ms) =>
      new Promise((resolve, reject) => setTimeout(() => (alive ? resolve() : reject(new Error("stopped"))), ms));
    const set = (patch) => alive && setS((prev) => ({ ...prev, ...patch }));
    const type = async (text) => {
      for (let i = 1; i <= text.length; i++) {
        set({ input: text.slice(0, i), typing: true });
        await wait(32);
      }
      await wait(250);
      set({ input: "", typing: false });
    };
    const stream = async (key, total) => {
      for (let i = 1; i <= total; i++) {
        set({ [key]: i });
        await wait(55);
      }
    };

    (async () => {
      try {
        for (;;) {
          while (!(visible.current && document.visibilityState !== "hidden")) await wait(500);
          set(EMPTY);
          await wait(500);
          await type(Q1);
          set({ q1: true });
          await wait(300);
          set({ t1: true });
          await wait(900);
          set({ t1: false, a1: 0 });
          await stream("a1", count(W1));
          await wait(200);
          set({ s1: true });
          await wait(1200);
          await type(Q2);
          set({ q2: true });
          await wait(300);
          set({ t2: true });
          await wait(800);
          set({ t2: false, a2: 0 });
          await stream("a2", count(W2));
          await wait(3500);
        }
      } catch {
        // Unmounted: stop quietly.
      }
    })();

    return () => {
      alive = false;
      io?.disconnect();
    };
  }, []);

  return (
    <div
      className={styles.mock}
      role="img"
      aria-label="Example: a point-of-sale dashboard with the sideagent chat docked on the right. It answers a question in Indonesian and lists two sources, then declines an off-topic question."
    >
      <div className={styles.mockBar} aria-hidden="true">
        <i />
        <i />
        <i />
        <span>app.contoh-kasir.id/pengaturan</span>
      </div>
      <div className={styles.mockBody} aria-hidden="true">
        <div className={styles.mockApp}>
          <div className={styles.mockAppTitle}>Pengaturan</div>
          <div className={`${styles.skel} ${styles.w60}`} />
          <div className={styles.skelCard} />
          <div className={`${styles.skel} ${styles.w80}`} />
          <div className={`${styles.skel} ${styles.w40}`} />
          <div className={styles.skelCard} />
          <div className={`${styles.skel} ${styles.w60}`} />
        </div>
        <div className={styles.mockChat}>
          <div className={styles.chatHead}>
            Bantuan <small>dari panduan resmi</small>
          </div>
          <div className={styles.chatLog} ref={logRef}>
            {s.q1 && <div className={`${styles.msgUser} ${styles.rise}`}>{Q1}</div>}
            {s.t1 && <Typing />}
            {s.a1 >= 0 && (
              <div className={`${styles.msgBot} ${styles.rise}`}>
                <Answer ws={W1} shown={s.a1} />
                {s.s1 && (
                  <div className={`${styles.sources} ${styles.rise}`}>
                    <div className={styles.sourcesLabel}>
                      <Translate id="landing.demo.sources">Sources</Translate>
                    </div>
                    <ul>
                      {SOURCES.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {s.q2 && <div className={`${styles.msgUser} ${styles.rise}`}>{Q2}</div>}
            {s.t2 && <Typing />}
            {s.a2 >= 0 && (
              <div className={`${styles.msgBot} ${styles.msgDecline} ${styles.rise}`}>
                <Answer ws={W2} shown={s.a2} />
              </div>
            )}
          </div>
          <div className={styles.chatInput}>
            {s.typing ? (
              <span className={styles.typed}>
                {s.input}
                <span className={styles.caret} />
              </span>
            ) : (
              <span className={styles.placeholder}>{PLACEHOLDER}</span>
            )}
            <i />
          </div>
        </div>
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div className={styles.typing}>
      <i />
      <i />
      <i />
    </div>
  );
}
