---
sidebar_position: 5
title: Tema
---

Netral secara bawaan (skala abu-abu, font milik host, radius 10px). `theme="auto"` (atau `"system"`) mengikuti sistem operasi (kecuali host mengatur `.light` / `data-theme="light"` / `data-bs-theme="light"`) dan `.dark` / `data-theme="dark"` / `data-bs-theme="dark"` milik host; berikan `"light"` atau `"dark"` untuk memaksakan salah satunya. Sesuaikan dengan design system Anda melalui variabel CSS di `:root`:

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
