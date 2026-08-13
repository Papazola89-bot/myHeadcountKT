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

- Portal Guru melalui kod akses rahsia sekolah dan Portal Admin melalui akaun Google pemilik sahaja.
- Dashboard, filter, graf, murid perlu tindakan dan profil individu.
- Headcount TOV, OTI, AR dan ETR dengan autosave serta undo.
- Intervensi, tarikh semakan dan penghantaran yang disimpan ke Google Sheets.
- Analisis sekolah/daerah, heatmap, laporan, CSV, cetakan dan audit.
- Admin boleh menjana semula kod akses sekolah dan mengosongkan data operasi dengan pengesahan eksplisit.
- Paparan desktop, tablet dan telefon.

## Sambungan Google

Lapisan data frontend berada di `app/lib/data-service.ts`. Guru menggunakan kod akses rahsia sekolah dan menerima sesi enam jam yang dihadkan kepada `school_id` sekolah itu. Admin menggunakan Google Identity Services; hanya e-mel pemilik yang ditetapkan semasa `setupDatabase()` diterima. Semua permintaan membawa `request_id` unik. ID token dan token sesi hanya disimpan dalam memori.

Fail `google-apps-script/Code.gs` menyediakan:

- penciptaan jadual central database;
- pengesahan Google ID token terhadap Client ID aplikasi;
- pemadanan `google_sub` dan e-mel Google kepada pemilik tunggal;
- kod akses sekolah yang disimpan sebagai hash bersalt dan hanya dipaparkan sekali apabila dijana;
- semakan `school_id` pada backend bagi setiap akses murid;
- senarai sekolah sebenar daripada tab `SEKOLAH`, tambah sekolah, padam sekolah kosong dan clear data sekolah kosong untuk pentadbir;
- paparan serta agregat intervensi sebenar daripada tab `INTERVENSI` untuk guru dan pentadbir;
- simpan penilaian/intervensi, hantar cycle, lock dan audit log;
- `clearAllData` admin-only yang mengosongkan data operasi tetapi mengekalkan sekolah, kod akses, kemahiran induk dan akaun pemilik.

### Persediaan Apps Script

1. Buka projek Apps Script yang menghasilkan URL di atas.
2. Gantikan kandungan fail skrip dengan `google-apps-script/Code.gs`.
3. Jika skrip terikat pada Google Sheet, jalankan `setupDatabase()`. Jika standalone, jalankan `setupDatabase("SPREADSHEET_ID_ANDA")`.
4. Benarkan kebenaran Google yang diminta. Fungsi ini mencipta tab `SEKOLAH`, `PENGGUNA`, `MURID`, `PENILAIAN`, `SASARAN`, `INTERVENSI`, `SUBMISSION`, `MASTER_KEMAHIRAN` dan `AUDIT_LOG`.
5. Pastikan Script Property `OWNER_ADMIN_EMAIL` yang ditetapkan oleh `setupDatabase()` ialah e-mel Google pemilik. Akaun Google lain akan ditolak.
6. Tambah sekolah melalui portal Admin. Sistem menjana kod rahsia `KT-...`; salin sekali dan serahkan kepada guru sekolah berkenaan. Kod JBA awam bukan kod log masuk.
7. Pilih **Deploy → Manage deployments → Edit → New version → Deploy**. Gunakan **Execute as: Me** kerana identiti dan skop masih disahkan oleh backend.
8. Buka URL `/exec?action=health`. Respons sepatutnya JSON dengan `"status":"ok"` dan versi semasa.

OAuth Web Client menggunakan Client ID `491720020946-9f6ifkrt5nrrpu4a7dsqeunv9iu0ell6.apps.googleusercontent.com`. Pastikan `https://sihadir-headcount.geek2606.chatgpt.site` dan `http://localhost:3000` telah didaftarkan sebagai **Authorized JavaScript origins**. Client Secret tidak diperlukan oleh frontend dan tidak boleh dimasukkan ke repositori.

Kod backend sentiasa menentukan `school_id` dan peranan pada pelayan; nilai daripada frontend tidak dipercayai. Untuk MVP Apps Script ini, token admin disahkan melalui endpoint Google `tokeninfo`. Bagi penggunaan berskala besar, pindahkan pengesahan kepada gerbang server-side yang menggunakan JWT/JWKS atau library rasmi Google.

## Binaan produksi

```bash
npm run build
npm run start
```
