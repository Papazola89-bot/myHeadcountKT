# myHeadcountKT

Sistem Headcount & Intervensi Pemulihan Khas ialah prototaip web responsif bagi Portal Guru dan Portal Admin.

## Cuba secara tempatan

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`. Aplikasi telah dikonfigurasi untuk menggunakan Google Apps Script berikut sebagai sumber utama:

`https://script.google.com/macros/s/AKfycbxxplK0PDUs2sS0_CkVes8RB9c42dSX8ptP7ZMMXmGDJl1Nt_rO7fOMS99YN2SFChvY/exec`

Jika backend belum tersedia, aplikasi tidak memaparkan data contoh atau menganggap perubahan telah berjaya disimpan.

## Fungsi utama

- Portal Guru melalui kod rasmi sekolah sendiri dan Portal Admin melalui sehingga 3 akaun Google pentadbir.
- Setiap sekolah mendaftarkan muridnya sendiri; semua headcount dibina daripada rekod murid tersebut dan digabungkan dalam paparan admin.
- Dashboard, filter, graf, murid perlu tindakan dan profil individu.
- Headcount TOV, OTI, AR dan ETR dengan autosave serta undo.
- Intervensi, tarikh semakan dan penghantaran yang disimpan ke Google Sheets.
- Analisis sekolah/daerah, heatmap, laporan, CSV, cetakan dan audit.
- Ketiga-tiga admin mempunyai akses penuh yang sama untuk mengurus sekolah, murid, headcount, intervensi, laporan dan tetapan.
- Pindah dalam daerah menghantar murid ke senarai **Import Murid** sekolah penerima bersama sejarah headcount.
- Pindah luar daerah atau negeri mengeluarkan murid daripada senarai aktif dan mengekalkannya dalam **Apungan** untuk semakan admin.
- Admin boleh menambah dua pentadbir lagi dan mengosongkan data operasi dengan pengesahan eksplisit.
- Paparan desktop, tablet dan telefon.

## Sambungan Google

Lapisan data frontend berada di `app/lib/data-service.ts`. Guru memasukkan kod rasmi sekolah (contohnya `JBA3012`) dan menerima sesi enam jam yang dihadkan kepada `school_id` sekolah itu. Tiada kod individu guru perlu dijana. Admin menggunakan Google Identity Services; e-mel Google mestilah salah satu daripada maksimum tiga akaun ADMIN aktif dalam tab `PENGGUNA`. Semua permintaan membawa `request_id` unik. ID token dan token sesi hanya disimpan dalam memori.

Fail `google-apps-script/Code.gs` menyediakan:

- penciptaan jadual central database;
- pengesahan Google ID token terhadap Client ID aplikasi;
- pemadanan `google_sub` dan e-mel Google kepada pentadbir berdaftar;
- pengurusan maksimum tiga akaun pentadbir akses penuh dengan semakan peranan pada pelayan;
- pengesahan kod rasmi sekolah terhadap rekod aktif dalam tab `SEKOLAH`;
- semakan `school_id` pada backend bagi setiap akses murid;
- senarai sekolah sebenar daripada tab `SEKOLAH`, tambah sekolah, padam sekolah kosong dan clear data sekolah kosong untuk pentadbir;
- paparan serta agregat intervensi sebenar daripada tab `INTERVENSI` untuk guru dan pentadbir;
- simpan penilaian/intervensi, hantar cycle, lock dan audit log;
- aliran `PERPINDAHAN` untuk import dalam daerah serta status `Apungan` bagi murid keluar daerah/negeri tanpa memadam sejarah;
- `clearAllData` admin-only yang mengosongkan data operasi tetapi mengekalkan sekolah, kemahiran induk dan semua akaun pentadbir.

### Persediaan Apps Script

1. Buka projek Apps Script yang menghasilkan URL di atas.
2. Gantikan kandungan fail skrip dengan `google-apps-script/Code.gs`.
3. Jika skrip terikat pada Google Sheet, jalankan `setupDatabase()`. Jika standalone, jalankan `setupDatabase("SPREADSHEET_ID_ANDA")`.
4. Benarkan kebenaran Google yang diminta. Fungsi ini mencipta tab `SEKOLAH`, `PENGGUNA`, `MURID`, `PENILAIAN`, `SASARAN`, `INTERVENSI`, `SUBMISSION`, `PERPINDAHAN`, `MASTER_KEMAHIRAN` dan `AUDIT_LOG`.
5. Pastikan Script Property `OWNER_ADMIN_EMAIL` yang ditetapkan oleh `setupDatabase()` ialah e-mel Google pentadbir pertama.
6. Log masuk sebagai pentadbir pertama, buka **Pengguna → Tambah Admin**, kemudian masukkan nama dan e-mel Google dua pegawai lain. Ketiga-tiganya menerima akses penuh.
7. Tambah sekolah melalui portal Admin menggunakan kod rasmi sekolah. Guru menggunakan kod yang sama untuk log masuk; tiada proses jana kod guru.
8. Pilih **Deploy → Manage deployments → Edit → New version → Deploy**. Gunakan **Execute as: Me** kerana identiti dan skop masih disahkan oleh backend.
9. Buka URL `/exec?action=health`. Respons sepatutnya JSON dengan `"status":"ok"` dan versi `1.4.0`.

OAuth Web Client menggunakan Client ID `491720020946-9f6ifkrt5nrrpu4a7dsqeunv9iu0ell6.apps.googleusercontent.com`. Pastikan `https://sihadir-headcount.geek2606.chatgpt.site`, `https://myheadcountkt.vercel.app` dan `http://localhost:3000` telah didaftarkan sebagai **Authorized JavaScript origins**. Client Secret tidak diperlukan oleh frontend dan tidak boleh dimasukkan ke repositori.

Kod backend sentiasa menentukan `school_id` dan peranan pada pelayan; nilai daripada frontend tidak dipercayai. Untuk MVP Apps Script ini, token admin disahkan melalui endpoint Google `tokeninfo`. Bagi penggunaan berskala besar, pindahkan pengesahan kepada gerbang server-side yang menggunakan JWT/JWKS atau library rasmi Google.

## Binaan produksi

```bash
npm run build
npm run start
```
