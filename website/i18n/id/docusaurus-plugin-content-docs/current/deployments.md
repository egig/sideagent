---
sidebar_position: 9
title: Deployments
---

## Daftar periksa {#checklist}

- [ ] `SIDEAGENT_SECRET` panjang dan acak, dan juga disimpan di luar server. Jika hilang, LLM key yang tersimpan tidak dapat dibaca.
- [ ] `DATABASE_URL` adalah Postgres dengan pgvector, dan dicadangkan.
- [ ] `publicUrl` adalah URL persis yang diketik orang di browser, dengan HTTPS.
- [ ] Sign-up ditutup setelah tim Anda memiliki akun (`SIGNUP` tidak diatur atau `auth.signup: false`).
- [ ] Setiap agent hanya mendaftarkan origin aplikasi Anda yang sebenarnya, dan **User auth**-nya sesuai dengan produk Anda: mode JWT atau userinfo untuk produk dengan pengguna yang sudah sign-in, tanpa autentikasi untuk dokumentasi publik (pengunjung anonim kemudian tidak menyimpan history).
- [ ] Setiap sumber Knowledge Base adalah sesuatu yang boleh dibaca semua pengguna: agent dapat mengutip passage mana pun yang ditemukannya.
- [ ] Sign-in lewat email memiliki `auth.sendMagicLink`, atau Anda memakai GitHub atau Google.
- [ ] Di belakang proxy, `rateLimit` dan `clientIp` membaca alamat client yang sebenarnya, dan proxy menimpa `x-forwarded-for`.

## CORS dan origin {#cors-and-origins}

Request tanpa header `Origin`, atau dari origin yang tidak ada di daftar yang diizinkan agent, ditolak dan dicatat di audit sebagai *Denied*. Panggilan server-ke-server dan `curl` memerlukan header `Origin`. Hanya `POST` dan `OPTIONS` yang diizinkan, dan `Content-Type` harus `application/json`.

## Rate limit dan kuota {#rate-limits-and-quotas}

Server membatasi request per alamat, turn bersamaan per pengguna, dan pesan anonim per agent per hari. Counter tersebut berlaku per proses: dengan beberapa instance, masing-masing menghitung sendiri. Berikan `rateLimit` untuk limiter bersama.

Batas tetap: badan request 256 KB, pesan 8000 karakter, 8 langkah dan 120 detik per turn.

## Streaming dan proxy {#streaming-and-proxies}

Response berupa server-sent events. Reverse proxy dan CDN tidak boleh mem-buffer-nya, atau pengguna tidak melihat teks apa pun hingga turn selesai. Matikan buffering untuk `/v1/` (untuk nginx: `proxy_buffering off;`). Atur batas waktu fungsi platform di atas 120 detik.

## Hal lain yang perlu diketahui {#other-things-to-know}

- Instruksi agent adalah bagian dari system prompt-nya. Gunakan untuk nada dan aturan domain, bukan untuk keamanan.
- Prop `context` pada `AgentChat` berasal dari browser, sehingga pengguna dapat memalsukannya. Isinya dipotong menjadi 4000 karakter dan diberikan ke model sebagai konteks halaman yang tidak tepercaya. Jangan pernah memakainya untuk kontrol akses, dan jangan taruh secret di dalamnya.
- Balasan asisten dirender sebagai Markdown (GFM) dengan HTML mentah dibuang; tautan dibuka di tab baru dengan `noopener noreferrer`.
- Model harus mendukung tool calling, yang dipakai oleh knowledge search.
