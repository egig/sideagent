---
sidebar_position: 7
title: Chat history
---

`AgentChat` has a History button (list, open, delete) and reopens the last conversation after a refresh. The server keeps the messages and the list in its database. Users only see their own threads.

Turn history off with `history={false}`: no History button, and the chat does not remember or reopen the last conversation, so every visit starts fresh. The server still keeps its threads.

## Limits

- Anonymous visitors (agents with no user auth) keep nothing: each request is its own user and thread.
- Threads are bound to the user the server derived from `getToken`'s token. Another user cannot open them.
- A signed-in user's threads are deleted when the agent is deleted.
