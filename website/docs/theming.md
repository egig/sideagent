---
sidebar_position: 5
title: Theming
---

Neutral by default (grayscale, host font, 10px radius). `theme="auto"` (or `"system"`) follows the OS and a host `.dark` / `data-theme="dark"` / `data-bs-theme="dark"`; pass `"light"` or `"dark"` to force one. Match your design system with CSS variables on `:root`:

```css
:root {
  --sideagent-accent: var(--primary);      /* buttons */
  --sideagent-accent-fg: var(--primary-foreground);
  --sideagent-bg: var(--background);
  --sideagent-fg: var(--foreground);
  --sideagent-border: var(--border);
  --sideagent-surface: var(--muted);       /* user bubble, hovers */
  --sideagent-muted: var(--muted-foreground);
  --sideagent-radius: 10px;
  --sideagent-font: inherit;
}
```
