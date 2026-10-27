---
type: regex
pattern: "(sk-[A-Za-z0-9]{10,}|apiKey:\\s*[\"'][^\"']{8,}[\"'])"
match: not_contains
target: trace
---
