import { MessagePrimitive, useAuiState } from "@assistant-ui/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolCard } from "./ToolCard.js";

/** Plain-text only: model output is never rendered as HTML and links/images are never auto-loaded. */
const Text = ({ text }: { text: string }) => <span>{text}</span>;

/** Model output is untrusted: react-markdown drops raw HTML, and links open in a new tab without referrer. */
const mdComponents = {
  a: ({ node: _n, ...p }: any) => <a {...p} target="_blank" rel="noopener noreferrer nofollow" />,
};

export const UserMessage = () => (
  <MessagePrimitive.Root className="sa-msg sa-user">
    <MessagePrimitive.Parts components={{ Text }} />
  </MessagePrimitive.Root>
);

/** Dots while the assistant message is running and nothing has streamed into it yet. */
function Typing() {
  const waiting = useAuiState(
    (s) => s.message.status?.type === "running" && !s.message.content.some((c: any) => c.type !== "text" || c.text),
  );
  return waiting ? (
    <div className="sa-msg sa-assistant sa-typing" role="status" aria-label="Assistant is typing">
      <span />
      <span />
      <span />
    </div>
  ) : null;
}

export const AssistantMessage = () => (
  <MessagePrimitive.Root style={{ display: "contents" }}>
    <Typing />
    <MessagePrimitive.Parts
      components={{
        Text: ({ text }: { text: string }) =>
          text ? (
            <div className="sa-msg sa-assistant sa-md">
              <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {text}
              </Markdown>
            </div>
          ) : null,
        tools: { Fallback: ToolCard as any },
      }}
    />
  </MessagePrimitive.Root>
);
