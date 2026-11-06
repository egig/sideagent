---
sidebar_position: 3
title: Client
---

```tsx
import { AgentChat } from "sideagent";

<AgentChat
  publishableKey="pk_…"
  mode="floating"            // "floating" | "sidebar"; the user can switch
  hooks={{ onTurnEnd: () => track("agent_turn") }}
/>
```

Publishable key menyebutkan agent dan server yang menjalankannya. Chat menurunkan URL-nya (`https://<host>/v1/agents/<agentId>`) dan mengirim key di header `x-sideagent-key` pada setiap request. Key ini publik: aman berada di browser dan tidak membuktikan apa pun dengan sendirinya. Key yang formatnya salah akan melempar error saat render.

Judul panel adalah nama agent dari dashboard. Berikan `title` untuk memakai teks Anda sendiri.

Ketika agent akan menolak setiap pesan karena batas penggunaan tercapai (pengunjung anonim), chat tidak merender apa pun, termasuk tombol launcher-nya, hingga halaman dimuat ulang. Di bawah `AgentProvider`, `useAgent().available` juga bernilai `false`, jadi sembunyikan tombol "tanya" milik Anda sendiri.

## Pengguna yang sudah sign-in {#signed-in-users}

Berikan `getToken`, yang dipanggil chat sebelum setiap request, sehingga token yang kedaluwarsa selalu diambil ulang. Kembalikan `null` untuk pengunjung yang belum sign-in. Pengaturan **User auth** agent di dashboard menentukan cara server memeriksa token (JWT terhadap JWKS Anda, atau URL userinfo Anda). Jika `getToken` melempar error, request tidak dikirim dan chat menampilkan error.

Berikan `storageKey` (ID pengguna) agar percakapan terakhir yang diingat chat di `localStorage` menjadi milik pengguna tersebut; di browser bersama, pengguna lain memulai dari percakapannya sendiri.

```tsx
<AgentChat publishableKey="pk_…" getToken={() => auth.getAccessToken()} storageKey={user.id} />
```

## Layout {#layout}

Jika koneksi terputus saat jawaban sedang dialirkan, chat menampilkan "The connection was interrupted" alih-alih menyajikan jawaban parsial seolah-olah lengkap. Jika server tidak lagi memiliki percakapan tersebut (restart, kedaluwarsa), chat memulai percakapan baru dengan pesan Anda berikutnya.

Sembunyikan floating launcher dengan `launcher={false}` dan buka panel dari tombol Anda sendiri melalui `useAgent().setOpen`. Matikan chat history dengan `history={false}`. Sembunyikan tombol New chat dengan `newChatButton={false}`. Tambahkan tombol Anda sendiri ke header panel dengan `headerActions`.

### Sidebar yang menempel {#docked-sidebar}

Bungkus aplikasi Anda dengan `AgentProvider` untuk menempelkan chat di sisi kanan, berdampingan dengan aplikasi alih-alih menutupinya. Komponen ini menerima props yang sama dengan `AgentChat`. Pengguna menyeret tepi kiri panel (atau memakai tombol panah di sana) untuk mengubah lebarnya; lebar tersebut diingat. Di luar `AgentProvider`, mode sidebar menutupi halaman.

```tsx
import { AgentProvider } from "sideagent";

<AgentProvider publishableKey="pk_…" mode="sidebar" defaultOpen>
  <App />
</AgentProvider>
```

`AgentProvider` mengisi tinggi viewport (`100dvh`); ubah dengan props `className` atau `style`. Komponen apa pun di bawahnya dapat memanggil `useAgent()` untuk mendapatkan `{ open, setOpen, available }`.

## Layar kecil {#small-screens}

Pada lebar 640px atau kurang, panel terbuka layar penuh di setiap mode, dan layout switcher serta resize handle disembunyikan. Panel mematuhi safe-area inset ketika halaman Anda mengatur `viewport-fit=cover`. Halaman memerlukan `<meta name="viewport" content="width=device-width, initial-scale=1">`.

## Batasan {#limits}

- Tanpa `AgentProvider`, `mode="sidebar"` menutupi halaman alih-alih menempel.
- Lebar sidebar diingat di browser. Lebar ini tidak dibagikan antarperangkat.
