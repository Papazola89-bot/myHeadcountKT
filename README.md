# myHeadcountKT

Sistem Headcount & Intervensi Pemulihan Khas ialah prototaip web responsif bagi Portal Guru dan Portal Admin.

## Cuba secara tempatan

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`. Aplikasi telah dikonfigurasi untuk menggunakan Google Apps Script berikut sebagai sumber utama:

`https://script.google.com/macros/s/AKfycbxxplK0PDUs2sS0_CkVes8RB9c42dSX8ptP7ZMMXmGDJl1Nt_rO7fOMS99YN2SFChvY/exec`

Jika backend belum tersedia, aplikasi memaparkan status mod demo dan menggunakan cache pelayar tanpa kehilangan perubahan semasa.

## Fungsi prototaip

- Portal Guru dan Portal Admin dengan pertukaran peranan.
- Dashboard, filter, graf, murid perlu tindakan dan profil individu.
- Headcount TOV, OTI, AR dan ETR dengan autosave serta undo.
- Intervensi, tarikh semakan, evidens, penghantaran dan lock simulasi.
- Analisis sekolah/daerah, heatmap, laporan, CSV, cetakan dan audit.
- Paparan desktop, tablet dan telefon.

## Sambungan Google

Lapisan data frontend berada di `app/lib/data-service.ts`. Pengguna perlu log masuk melalui Google Identity Services sebelum aplikasi membaca murid, menambah murid, menyimpan penilaian/intervensi atau menghantar cycle. ID token disimpan dalam memori sahaja dan dihantar bersama `request_id` unik kepada Apps Script. `createLocalDataService` hanya digunakan sebagai cache/fallback.

Fail `google-apps-script/Code.gs` menyediakan:

- penciptaan jadual central database;
- pengesahan Google ID token terhadap Client ID aplikasi;
- pemadanan `google_sub` dan e-mel Google kepada pengguna serta sekolah;
- semakan `school_id` pada backend bagi setiap akses murid;
- senarai sekolah sebenar daripada tab `SEKOLAH`, tambah sekolah, padam sekolah kosong dan clear data sekolah kosong untuk pentadbir;
- simpan penilaian/intervensi, hantar cycle, lock dan audit log.

### Persediaan Apps Script

1. Buka projek Apps Script yang menghasilkan URL di atas.
2. Gantikan kandungan fail skrip dengan `google-apps-script/Code.gs`.
3. Jika skrip terikat pada Google Sheet, jalankan `setupDatabase()`. Jika standalone, jalankan `setupDatabase("SPREADSHEET_ID_ANDA")`.
4. Benarkan kebenaran Google yang diminta. Fungsi ini mencipta tab `SEKOLAH`, `PENGGUNA`, `MURID`, `PENILAIAN`, `SASARAN`, `INTERVENSI`, `SUBMISSION`, `MASTER_KEMAHIRAN` dan `AUDIT_LOG`.
5. Isi/semak `SEKOLAH` dan `PENGGUNA`. E-mel mesti sama dengan akaun Google guru; peranan ialah `GURU` atau `ADMIN` dan status ialah `Aktif`. Biarkan `google_sub` kosong untuk akaun lama; backend akan memautkannya sekali selepas log masuk pertama yang sah.
6. Pilihan: tetapkan Script Property `DEMO_GURU_EMAIL`, kemudian jalankan `seedDemoData()`.
7. Pilih **Deploy → Manage deployments → Edit → New version → Deploy**. Gunakan **Execute as: Me** kerana identiti pengguna disahkan melalui Google ID token dan akses data tetap dikawal melalui `PENGGUNA`.
8. Buka URL `/exec?action=health`. Respons sepatutnya JSON dengan `"status":"ok"`.

OAuth Web Client menggunakan Client ID `491720020946-9f6ifkrt5nrrpu4a7dsqeunv9iu0ell6.apps.googleusercontent.com`. Pastikan `https://sihadir-headcount.geek2606.chatgpt.site` dan `http://localhost:3000` telah didaftarkan sebagai **Authorized JavaScript origins**. Client Secret tidak diperlukan oleh frontend dan tidak boleh dimasukkan ke repositori.

Kod backend sentiasa menentukan `school_id`, peranan dan status daripada jadual `PENGGUNA`; nilai tersebut daripada frontend tidak dipercayai. Untuk MVP Apps Script ini, token disahkan melalui endpoint Google `tokeninfo`. Bagi penggunaan berskala besar, pindahkan pengesahan kepada gerbang server-side yang menggunakan JWT/JWKS atau library rasmi Google.

## Binaan produksi

```bash
npm run build
npm run start
```
