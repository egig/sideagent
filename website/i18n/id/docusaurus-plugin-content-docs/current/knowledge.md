---
sidebar_position: 8
title: Pengetahuan
---

Agen menjawab dari pengetahuan yang Anda tambahkan di dasbor (agen, tab **Knowledge**):

- **Halaman web.** URL HTTPS publik. Server yang mengambilnya, bukan peramban. Alamat privat dan alamat metadata sengaja ditolak, pengalihan (redirect) tidak diikuti, dan ukuran respons dibatasi.
- **Markdown.** Tempelkan teks.

Setiap sumber menampilkan *Queued*, *Indexed*, atau *Failed*. Sumber yang *Failed* biasanya berarti halamannya tidak publik, atau model embedding atau kuncinya salah. Jika model embedding diubah, pengetahuan diindeks ulang.

Model mendapat satu tool, `search_knowledge`. Ini satu-satunya tool agen: agen tidak dapat memanggil API Anda atau mengubah data. Jawaban menampilkan kartu "Sources", dengan tautan hanya untuk halaman web yang Anda tambahkan.

Jangan masukkan materi privat ke pengetahuan: agen dapat mengutip potongan teks mana pun yang ditemukannya. Potongan teks sampai ke model sebagai data berlabel yang tidak tepercaya, dan isi potongan teks hanya sampai ke peramban di pratinjau dasbor milik pemilik, tidak pernah untuk pengguna akhir.

## Cara kerja pencarian {#how-search-works}

Pencarian menggabungkan peringkat vektor dengan peringkat kata kunci BM25, sehingga potongan teks yang memakai kata-kata persis pengguna tetap ditemukan meskipun embedding menempatkannya sedikit di luar batas. Potongan teks dengan skor di bawah ambang relevansi agen dibuang, dan ketika tidak ada yang relevan, agen menyatakan bahwa ia tidak memiliki jawaban alih-alih menebak. Pertanyaan yang diulang atau sedikit diubah kata-katanya memakai kembali hasil sebelumnya; hasil ini dikosongkan setiap kali ada sumber yang diindeks.
