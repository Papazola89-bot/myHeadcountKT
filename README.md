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

Lapisan data frontend berada di `app/lib/data-service.ts`. Ia kini menggunakan `createAppsScriptDataService` untuk membaca murid, menambah murid, menyimpan penilaian/intervensi dan menghantar cycle. `createLocalDataService` hanya digunakan sebagai cache/fallback.

Fail `google-apps-script/Code.gs` menyediakan:

- penciptaan jadual central database;
- pemadanan akaun Google kepada pengguna dan sekolah;
- semakan `school_id` pada backend bagi setiap akses murid;
- simpan penilaian/intervensi, hantar cycle, lock dan audit log.

### Persediaan Apps Script

1. Buka projek Apps Script yang menghasilkan URL di atas.
2. Gantikan kandungan fail skrip dengan `google-apps-script/Code.gs`.
3. Jika skrip terikat pada Google Sheet, jalankan `setupDatabase()`. Jika standalone, jalankan `setupDatabase("SPREADSHEET_ID_ANDA")`.
4. Benarkan kebenaran Google yang diminta. Fungsi ini mencipta tab `SEKOLAH`, `PENGGUNA`, `MURID`, `PENILAIAN`, `SASARAN`, `INTERVENSI`, `SUBMISSION`, `MASTER_KEMAHIRAN` dan `AUDIT_LOG`.
5. Isi/semak `SEKOLAH` dan `PENGGUNA`. E-mel mesti sama dengan akaun Google guru; peranan ialah `GURU` atau `ADMIN` dan status ialah `Aktif`.
6. Pilihan: tetapkan Script Property `DEMO_GURU_EMAIL`, kemudian jalankan `seedDemoData()`.
7. Pilih **Deploy → Manage deployments → Edit → New version → Deploy**. Gunakan **Execute as: User accessing the web app** dan hadkan akses kepada domain/organisasi.
8. Buka URL `/exec?action=health`. Respons sepatutnya JSON dengan `"status":"ok"`.

Jika `Session.getActiveUser().getEmail()` kosong, backend menolak akses. Ini biasanya bermaksud tetapan **Execute as** atau akses domain belum betul. Kod backend sentiasa menentukan `school_id` daripada jadual `PENGGUNA`; nilai sekolah daripada guru tidak dipercayai.

## Binaan produksi

```bash
npm run build
npm run start
```
