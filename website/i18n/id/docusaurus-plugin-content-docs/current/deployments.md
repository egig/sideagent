---
sidebar_position: 9
title: Deployment
---

## Daftar periksa {#checklist}

- [ ] `SIDEAGENT_SECRET` panjang dan acak, dan juga disimpan di luar server. Jika hilang, kunci LLM yang tersimpan tidak dapat dibaca.
- [ ] `DATABASE_URL` adalah Postgres dengan pgvector, dan dicadangkan.
- [ ] `publicUrl` adalah URL persis yang diketik orang di peramban, dengan HTTPS.
- [ ] Pendaftaran ditutup setelah tim Anda memiliki akun (`SIGNUP` tidak diatur atau `auth.signup: false`).
- [ ] Setiap agen hanya mendaftarkan origin aplikasi Anda yang sebenarnya, dan **User auth**-nya sesuai dengan produk Anda: mode JWT atau userinfo untuk produk dengan pengguna yang masuk, tanpa autentikasi untuk dokumentasi publik (pengunjung anonim kemudian tidak menyimpan riwayat).
- [ ] Setiap sumber pengetahuan adalah sesuatu yang boleh dibaca semua pengguna: agen dapat mengutip potongan teks mana pun yang ditemukannya.
- [ ] Proses masuk lewat email memiliki `auth.sendMagicLink`, atau Anda memakai GitHub atau Google.
- [ ] Di belakang proxy, `rateLimit` dan `clientIp` membaca alamat klien yang sebenarnya, dan proxy menimpa `x-forwarded-for`.

## CORS dan origin {#cors-and-origins}

Permintaan tanpa header `Origin`, atau dari origin yang tidak ada di daftar yang diizinkan agen, ditolak dan dicatat di audit sebagai *Denied*. Panggilan server-ke-server dan `curl` memerlukan header `Origin`. Hanya `POST` dan `OPTIONS` yang diizinkan, dan `Content-Type` harus `application/json`.

## Batas laju dan kuota {#rate-limits-and-quotas}

Server membatasi permintaan per alamat, giliran bersamaan per pengguna, dan pesan anonim per agen per hari. Penghitung tersebut berlaku per proses: dengan beberapa instance, masing-masing menghitung sendiri. Berikan `rateLimit` untuk pembatas bersama.

Batas tetap: badan permintaan 256 KB, pesan 8000 karakter, 8 langkah dan 120 detik per giliran.

## Streaming dan proxy {#streaming-and-proxies}

Respons berupa server-sent events. Reverse proxy dan CDN tidak boleh mem-buffer-nya, atau pengguna tidak melihat teks apa pun hingga giliran selesai. Matikan buffering untuk `/v1/` (untuk nginx: `proxy_buffering off;`). Atur batas waktu fungsi platform di atas 120 detik.

## Hal lain yang perlu diketahui {#other-things-to-know}

- Instruksi agen adalah bagian dari system prompt-nya. Gunakan untuk nada dan aturan domain, bukan untuk keamanan.
- Prop `context` pada `AgentChat` berasal dari peramban, sehingga pengguna dapat memalsukannya. Isinya dipotong menjadi 4000 karakter dan diberikan ke model sebagai konteks halaman yang tidak tepercaya. Jangan pernah memakainya untuk kontrol akses, dan jangan taruh rahasia di dalamnya.
- Balasan asisten dirender sebagai Markdown (GFM) dengan HTML mentah dibuang; tautan dibuka di tab baru dengan `noopener noreferrer`.
- Model harus mendukung tool calling, yang dipakai oleh pencarian pengetahuan.
