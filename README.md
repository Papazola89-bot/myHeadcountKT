# SIHADIR

Sistem Headcount & Intervensi Pemulihan Khas ialah prototaip web responsif bagi Portal Guru dan Portal Admin.

## Cuba secara tempatan

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`. Data demo disimpan pada pelayar supaya kemas kini headcount, murid dan intervensi boleh dicuba terus.

## Fungsi prototaip

- Portal Guru dan Portal Admin dengan pertukaran peranan.
- Dashboard, filter, graf, murid perlu tindakan dan profil individu.
- Headcount TOV, OTI, AR dan ETR dengan autosave serta undo.
- Intervensi, tarikh semakan, evidens, penghantaran dan lock simulasi.
- Analisis sekolah/daerah, heatmap, laporan, CSV, cetakan dan audit.
- Paparan desktop, tablet dan telefon.

## Sambungan Google

Lapisan data frontend berada di `app/lib/data-service.ts`. Tukar `createLocalDataService` kepada `createAppsScriptDataService` selepas Web App Google Apps Script tersedia.

Fail `google-apps-script/Code.gs` menyediakan:

- penciptaan jadual central database;
- pemadanan akaun Google kepada pengguna dan sekolah;
- semakan `school_id` pada backend bagi setiap akses murid;
- simpan penilaian/intervensi, hantar cycle, lock dan audit log.

Salin `Code.gs` ke projek Apps Script yang terikat kepada Google Sheet, jalankan `setupDatabase()`, isi jadual `SEKOLAH` dan `PENGGUNA`, kemudian deploy sebagai Web App organisasi. Tetapkan deployment supaya skrip dijalankan sebagai pengguna yang mengakses; jika `Session.getActiveUser().getEmail()` kosong, deployment perlu disemak dan sistem akan menolak akses secara selamat.

## Binaan produksi

```bash
npm run build
npm run start
```
