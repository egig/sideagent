import { translate } from "@docusaurus/Translate";

// Roadmap entries. Status order on the page: next, later, explore, live. Plans, not commitments.
// Called at render so each string follows the current locale.
export function roadmapStatuses() {
  return [
    {
      key: "next",
      title: translate({ id: "roadmap.status.next.title", message: "Next" }),
      note: translate({ id: "roadmap.status.next.note", message: "Planned for the coming releases." }),
    },
    {
      key: "later",
      title: translate({ id: "roadmap.status.later.title", message: "Later" }),
      note: translate({ id: "roadmap.status.later.note", message: "Planned after the items above." }),
    },
    {
      key: "explore",
      title: translate({ id: "roadmap.status.explore.title", message: "Exploring" }),
      note: translate({ id: "roadmap.status.explore.note", message: "Under consideration." }),
    },
    {
      key: "live",
      title: translate({ id: "roadmap.status.live.title", message: "Available now" }),
      note: translate({ id: "roadmap.status.live.note", message: "In the open-source release today." }),
    },
  ];
}

export function roadmapAreas() {
  return {
    insights: translate({ id: "roadmap.area.insights", message: "Insights" }),
    support: translate({ id: "roadmap.area.support", message: "Support" }),
    knowledge: translate({ id: "roadmap.area.knowledge", message: "Knowledge" }),
    quality: translate({ id: "roadmap.area.quality", message: "Quality" }),
    hosting: translate({ id: "roadmap.area.hosting", message: "Hosting" }),
  };
}

export function roadmapItems() {
  return [
    {
      status: "next",
      area: "insights",
      title: translate({ id: "roadmap.insights.title", message: "Insights dashboard" }),
      body: translate({
        id: "roadmap.insights.body",
        message: "See what users ask, which questions got no answer, and which pages are cited most.",
      }),
      why: translate({
        id: "roadmap.insights.why",
        message: "Turns the assistant into a report on where your docs fall short.",
      }),
    },
    {
      status: "next",
      area: "insights",
      title: translate({ id: "roadmap.feedback.title", message: "Answer feedback" }),
      body: translate({
        id: "roadmap.feedback.body",
        message: "A thumbs up or down on each answer, with an optional reason.",
      }),
      why: translate({
        id: "roadmap.feedback.why",
        message: "Your team finds weak answers and fixes the page behind them.",
      }),
    },
    {
      status: "next",
      area: "support",
      title: translate({ id: "roadmap.handoff.title", message: "Handoff to your team" }),
      body: translate({
        id: "roadmap.handoff.body",
        message:
          "When the docs do not cover a question, offer a contact step that sends the conversation to email or your helpdesk.",
      }),
      why: translate({
        id: "roadmap.handoff.why",
        message: "No user ends at a dead end, and your team sees the full context.",
      }),
    },
    {
      status: "later",
      area: "insights",
      title: translate({ id: "roadmap.deflection.title", message: "Deflection report" }),
      body: translate({
        id: "roadmap.deflection.body",
        message:
          "A monthly estimate of tickets avoided, based on answered conversations that did not continue to support.",
      }),
      why: translate({ id: "roadmap.deflection.why", message: "A number to bring to the budget review." }),
    },
    {
      status: "later",
      area: "support",
      title: translate({ id: "roadmap.context.title", message: "Read-only account context" }),
      body: translate({
        id: "roadmap.context.body",
        message:
          "Let the assistant read fields you approve, such as a user's plan or enabled features, to tailor answers.",
      }),
      why: translate({
        id: "roadmap.context.why",
        message: "More useful answers, while the assistant still cannot change anything.",
      }),
    },
    {
      status: "later",
      area: "support",
      title: translate({ id: "roadmap.helpdesk.title", message: "Helpdesk integrations" }),
      body: translate({
        id: "roadmap.helpdesk.body",
        message: "Create tickets with the conversation attached in the helpdesk tools your team already uses.",
      }),
      why: translate({ id: "roadmap.helpdesk.why", message: "Handoff without copy and paste." }),
    },
    {
      status: "explore",
      area: "knowledge",
      title: translate({ id: "roadmap.refresh.title", message: "Scheduled refresh" }),
      body: translate({ id: "roadmap.refresh.body", message: "Re-fetch help-centre pages on a schedule." }),
      why: translate({ id: "roadmap.refresh.why", message: "Answers follow your docs as they change." }),
    },
    {
      status: "live",
      area: "quality",
      title: translate({ id: "roadmap.sources.title", message: "Sources on every answer" }),
      body: translate({
        id: "roadmap.sources.body",
        message: "Each answer lists the pages it came from, linked to your own URLs.",
      }),
    },
    {
      status: "live",
      area: "quality",
      title: translate({ id: "roadmap.gate.title", message: "Relevance gate" }),
      body: translate({
        id: "roadmap.gate.body",
        message: "Questions your docs do not cover are declined instead of guessed.",
      }),
    },
    {
      status: "live",
      area: "support",
      title: translate({ id: "roadmap.threads.title", message: "Per-user conversations" }),
      body: translate({
        id: "roadmap.threads.body",
        message: "Threads bound to the signed-in user, with history the user can return to.",
      }),
    },
    {
      status: "live",
      area: "insights",
      title: translate({ id: "roadmap.audit.title", message: "Audit log and traces" }),
      body: translate({ id: "roadmap.audit.body", message: "A record of each turn for debugging and compliance." }),
    },
    {
      status: "live",
      area: "knowledge",
      title: translate({ id: "roadmap.preview.title", message: "Dashboard preview" }),
      body: translate({
        id: "roadmap.preview.body",
        message: "Try questions against your docs, with the passages shown, before the agent goes live.",
      }),
    },
    {
      status: "live",
      area: "hosting",
      title: translate({ id: "roadmap.runtimes.title", message: "Node or Cloudflare Workers" }),
      body: translate({
        id: "roadmap.runtimes.body",
        message: "Run the server on Node, or at the edge on Workers with Workers AI.",
      }),
    },
  ];
}
