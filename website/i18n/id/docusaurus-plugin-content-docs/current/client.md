---
sidebar_position: 3
title: Klien
---

```tsx
import { AgentChat } from "sideagent";

<AgentChat
  publishableKey="pk_…"
  mode="floating"            // "floating" | "sidebar"; the user can switch
  hooks={{ onTurnEnd: () => track("agent_turn") }}
/>
```

Publishable key menyebutkan agen dan server yang menjalankannya. Chat menurunkan URL-nya (`https://<host>/v1/agents/<agentId>`) dan mengirim kunci di header `x-sideagent-key` pada setiap permintaan. Kunci ini publik: aman berada di peramban dan tidak membuktikan apa pun dengan sendirinya. Kunci yang formatnya salah akan melempar galat saat render.

Judul panel adalah nama agen dari dasbor. Berikan `title` untuk memakai teks Anda sendiri.

Ketika agen akan menolak setiap pesan karena batas penggunaan tercapai (pengunjung anonim), chat tidak merender apa pun, termasuk tombol peluncurnya, hingga halaman dimuat ulang. Di bawah `AgentProvider`, `useAgent().available` juga bernilai `false`, jadi sembunyikan tombol "tanya" milik Anda sendiri.

## Pengguna yang sudah masuk {#signed-in-users}

Berikan `getToken`, yang dipanggil chat sebelum setiap permintaan, sehingga token yang kedaluwarsa selalu diambil ulang. Kembalikan `null` untuk pengunjung yang belum masuk. Pengaturan **User auth** agen di dasbor menentukan cara server memeriksa token (JWT terhadap JWKS Anda, atau URL userinfo Anda). Jika `getToken` melempar galat, permintaan tidak dikirim dan chat menampilkan galat.

Berikan `storageKey` (ID pengguna) agar percakapan terakhir yang diingat chat di `localStorage` menjadi milik pengguna tersebut; di peramban bersama, pengguna lain memulai dari percakapannya sendiri.

```tsx
<AgentChat publishableKey="pk_…" getToken={() => auth.getAccessToken()} storageKey={user.id} />
```

## Tata letak {#layout}

Jika koneksi terputus saat jawaban sedang dialirkan, chat menampilkan "The connection was interrupted" alih-alih menyajikan jawaban parsial seolah-olah lengkap. Jika server tidak lagi memiliki percakapan tersebut (restart, kedaluwarsa), chat memulai percakapan baru dengan pesan Anda berikutnya.

Sembunyikan peluncur mengambang dengan `launcher={false}` dan buka panel dari tombol Anda sendiri melalui `useAgent().setOpen`. Matikan riwayat chat dengan `history={false}`. Sembunyikan tombol New chat dengan `newChatButton={false}`. Tambahkan tombol Anda sendiri ke header panel dengan `headerActions`.

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

Pada lebar 640px atau kurang, panel terbuka layar penuh di setiap mode, dan pengalih tata letak serta pegangan pengubah ukuran disembunyikan. Panel mematuhi safe-area inset ketika halaman Anda mengatur `viewport-fit=cover`. Halaman memerlukan `<meta name="viewport" content="width=device-width, initial-scale=1">`.

## Batasan {#limits}

- Tanpa `AgentProvider`, `mode="sidebar"` menutupi halaman alih-alih menempel.
- Lebar sidebar diingat di peramban. Lebar ini tidak dibagikan antarperangkat.
