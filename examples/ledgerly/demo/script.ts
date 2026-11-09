// A scripted OpenAI-compatible /chat/completions endpoint that answers the demo's questions the way a real model
// would: search the knowledge first, then answer from what the page context and the docs say. Anything else gets a
// short generic answer. Streams word by word, like a model does.
type Part = { type?: string; text?: string };
type Msg = { role: string; content?: string | Part[] | null };

const text = (m: Msg | undefined) =>
  typeof m?.content === "string"
    ? m.content
    : (m?.content ?? [])
        .map((p) => p.text ?? "")
        .join("")
        .trim();

const ANSWERS: [RegExp, string][] = [
  [
    /(payment|charge|card).*(fail|declin)|fail.*(payment|charge)/i,
    "Your last charge failed because your bank declined the card. Receipt RCP-2041 for $19.00 (Pro plan, 1 Nov) came back as `card_declined`.\n\n" +
      "Ledgerly retries on 4 Nov and again 5 days later. To fix it now:\n\n" +
      "1. Use another card, or ask your bank to allow the charge.\n" +
      "2. Open **Billing → Payment method** and update the Visa ending 4242.\n" +
      "3. Choose **Retry payment** on the billing page.\n\n" +
      "If every retry fails, your account moves to the Free plan. Your data is kept.",
  ],
  [
    /(invite|add).*(teammate|member|seat|user|person)|seats?/i,
    "Yes, you can add one more person. Your Pro plan has 5 seats and 4 are in use, including the pending invite for Jo Alvarez, since pending invites count as seats.\n\n" +
      "Open **Team → Invite teammate**. Pick a role: Admin can manage invoices and settings, Member can create invoices, Viewer is read only. The invite is valid for 7 days.\n\n" +
      "Once all 5 seats are used, you need the Business plan (20 seats) to invite anyone else.",
  ],
  [
    /vat|tax/i,
    "Set your rates once in **Settings → Taxes**, for example `VAT 20%`. Then pick a rate on each line item. A line item without a rate is not taxed.\n\n" +
      "Prices are tax-exclusive by default. Switch an invoice to tax-inclusive in its settings if you quote prices with tax included. Ledgerly does not file taxes for you, but **Reports → Tax** gives your accountant a summary.",
  ],
  [
    /overdue|late|reminder/i,
    "Invoice INV-0041 for Globex ($940.00) is overdue; it was due on 28 Oct. Ledgerly sends reminders 3 and 10 days after the due date. You can also open the invoice and resend it from there.",
  ],
];

const FALLBACK =
  "Here is what the Ledgerly docs say about that: open the section in the sidebar for details, or ask me about invoices, taxes, payments, plans or your team.";

const DECLINE =
  "I can only help with Ledgerly and its documentation, so a poem is outside what I can do. What would you like to know about invoices, taxes, payments or your team?";

function answer(question: string): string {
  return ANSWERS.find(([re]) => re.test(question))?.[1] ?? FALLBACK;
}

export async function demoLlmHandler(request: Request): Promise<Response> {
  const body = (await request.json()) as { messages: Msg[]; stream?: boolean };
  const last = body.messages[body.messages.length - 1];
  const question = text([...body.messages].reverse().find((m) => m.role === "user"));
  const id = `chatcmpl-demo-${crypto.randomUUID()}`;
  const base = { id, object: "chat.completion.chunk", created: 0, model: "demo-chat" };
  // The off-topic reply: the library asks the model to decline politely, with no tools.
  const declining = body.messages.some(
    (m) => m.role === "system" && text(m).includes("not something this product's documentation covers"),
  );
  const call = declining || last?.role === "tool" ? undefined : { name: "search_knowledge", args: { query: question } };
  const reply = declining ? DECLINE : call ? "" : answer(question);

  if (!body.stream) {
    return Response.json({
      id,
      object: "chat.completion",
      created: 0,
      model: "demo-chat",
      choices: [
        {
          index: 0,
          finish_reason: call ? "tool_calls" : "stop",
          message: call
            ? {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: call.name, arguments: JSON.stringify(call.args) },
                  },
                ],
              }
            : { role: "assistant", content: reply },
        },
      ],
    });
  }

  const chunks: unknown[] = [{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" } }] }];
  if (call) {
    chunks.push({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: `call_${Math.random().toString(36).slice(2, 8)}`,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              },
            ],
          },
        },
      ],
    });
    chunks.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
  } else {
    for (const w of reply.split(/(?<= )/)) chunks.push({ ...base, choices: [{ index: 0, delta: { content: w } }] });
    chunks.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  }
  const sse = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(sse, { headers: { "content-type": "text/event-stream" } });
}

// Embeddings for the demo: a bag of words without the common ones, so a question about the product matches its
// docs and a question about anything else matches nothing. The library's test embeddings count every word, "the"
// included, which makes everything look a little relevant.
const STOP = new Set(
  "a an the and or but of to in on at for with by from as is are was were be been it its this that these those i me my we our you your he she they them do does did can could would should will how what why when where who which about into over than then so if not no yes please".split(
    " ",
  ),
);
const DIM = 512;
// A crude stem, so "failed", "fails" and "failure" count as one word.
const stem = (w: string) => w.replace(/(ing|ed|es|s|ure)$/, "");
const hash = (t: string) => {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return Math.abs(h) % DIM;
};
export function demoEmbed(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) if (!STOP.has(w)) v[hash(stem(w))]! += 1;
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / n);
}
export const demoEmbeddings = {
  embedDocuments: async (texts: string[]) => texts.map(demoEmbed),
  embedQuery: async (text: string) => demoEmbed(text),
};
