---
sidebar_position: 7
title: Chat history
---

`AgentChat` memiliki tombol History (daftar, buka, hapus) dan membuka kembali percakapan terakhir setelah halaman dimuat ulang. Server menyimpan pesan dan daftarnya di database. Pengguna hanya melihat thread miliknya sendiri.

Matikan history dengan `history={false}`: tidak ada tombol History, dan chat tidak mengingat atau membuka kembali percakapan terakhir, sehingga setiap kunjungan dimulai dari awal. Server tetap menyimpan thread-nya.

## Batasan {#limits}

- Pengunjung anonim (agent tanpa user auth) tidak menyimpan apa pun: setiap request adalah pengguna dan thread tersendiri.
- Thread terikat pada pengguna yang diturunkan server dari token `getToken`. Pengguna lain tidak dapat membukanya.
- Thread milik pengguna yang sudah sign-in dihapus ketika agent-nya dihapus.
