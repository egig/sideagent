---
sidebar_position: 8
title: Knowledge Base
---

Agent menjawab dari Knowledge Base yang Anda tambahkan di dashboard (agent, tab **Knowledge**):

- **Halaman web.** URL HTTPS publik. Server yang mengambilnya, bukan browser. Alamat privat dan alamat metadata sengaja ditolak, redirect tidak diikuti, dan ukuran response dibatasi.
- **Markdown.** Tempelkan teks.

Setiap sumber menampilkan *Queued*, *Indexed*, atau *Failed*. Sumber yang *Failed* biasanya berarti halamannya tidak publik, atau model embedding atau key-nya salah. Jika model embedding diubah, Knowledge Base diindeks ulang.

Model mendapat satu tool, `search_knowledge`. Ini satu-satunya tool agent: agent tidak dapat memanggil API Anda atau mengubah data. Jawaban menampilkan kartu "Sources", dengan tautan hanya untuk halaman web yang Anda tambahkan.

Jangan masukkan materi privat ke Knowledge Base: agent dapat mengutip passage mana pun yang ditemukannya. Passage sampai ke model sebagai data berlabel yang tidak tepercaya, dan isi passage hanya sampai ke browser di preview dashboard milik pemilik, tidak pernah untuk pengguna akhir.

## Cara kerja pencarian {#how-search-works}

Pencarian menggabungkan vector ranking dengan ranking keyword BM25, sehingga passage yang memakai kata-kata persis pengguna tetap ditemukan meskipun embedding menempatkannya sedikit di luar batas. Passage dengan skor di bawah relevance threshold agent dibuang, dan ketika tidak ada yang relevan, agent menyatakan bahwa ia tidak memiliki jawaban alih-alih menebak. Pertanyaan yang diulang atau sedikit diubah kata-katanya memakai kembali hasil sebelumnya; hasil ini dikosongkan setiap kali ada sumber yang diindeks.
