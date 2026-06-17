const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// MENGHUBUNGKAN KE DATABASE HASIL MIGRASI ANDA
// Path diarahkan ke folder 'database' dan file 'database_aplikasi.db'
const dbPath = path.join(__dirname, 'database', 'database_aplikasi.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Gagal membuka database SQLite:', err.message);
  } else {
    console.log('✅ Terhubung sukses ke SQLite: database/database_aplikasi.db');
    
    // AUTO-CREATE TABLES IF MISSING (Mencegah error tabel tidak ditemukan)
    // Ditambahkan kolom picker TEXT dan approval TEXT pada tabel history & pending untuk mencatat penanggung jawab
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS data_users (username TEXT, password TEXT, role TEXT, fullName TEXT)`);
      db.run(`CREATE TABLE IF NOT EXISTS data_master (lokasi TEXT, model TEXT, pn TEXT, pn1 TEXT, description TEXT, yp NUMERIC, ys NUMERIC, total NUMERIC)`);
      
      // Auto-update skema jika tabel sudah ada namun belum memiliki kolom picker/approval
      db.run(`CREATE TABLE IF NOT EXISTS data_history_sc (lokasi TEXT, model TEXT, pn TEXT, material TEXT, waktu DATETIME, odf TEXT, yp NUMERIC, ys NUMERIC, in_out TEXT, keterangan TEXT, no_ro TEXT, status TEXT, picker TEXT, approval TEXT)`);
      db.run(`CREATE TABLE IF NOT EXISTS data_sc_pending (lokasi TEXT, model TEXT, material TEXT, pn TEXT, waktu DATETIME, odf TEXT, yp NUMERIC, ys NUMERIC, in_out TEXT, keterangan TEXT, no_ro TEXT, status TEXT, picker TEXT)`);
      
      // Query cadangan untuk memastikan kolom baru ditambahkan jika database lama sudah terbentuk
      db.run(`ALTER TABLE data_history_sc ADD COLUMN picker TEXT`, (err) => {});
      db.run(`ALTER TABLE data_history_sc ADD COLUMN approval TEXT`, (err) => {});
      db.run(`ALTER TABLE data_sc_pending ADD COLUMN picker TEXT`, (err) => {});
    });
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname)); // Melayani file statis dari root folder

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- API LOGIN ---
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const query = `SELECT * FROM data_users WHERE username = ? AND password = ?`;
  db.get(query, [username, password], (err, user) => {
    if (err) return res.status(500).json({ success: false, message: 'Internal Server Error' });
    if (user) {
      res.json({ success: true, role: user.role, fullName: user.fullName, username: user.username });
    } else {
      res.json({ success: false, message: 'Username atau Password salah!' });
    }
  });
});

// --- API REGISTRASI (SUPERADMIN ONLY) ---
app.post('/api/register', (req, res) => {
  const { username, password, role, fullName } = req.body;
  
  if (!username || !password || !role || !fullName) {
      return res.status(400).json({ success: false, message: 'Semua kolom wajib diisi!' });
  }

  // Cek apakah username sudah ada
  db.get(`SELECT username FROM data_users WHERE username = ?`, [username], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: 'Internal Server Error' });
    if (row) return res.status(400).json({ success: false, message: 'Username sudah digunakan, silakan pilih yang lain!' });

    // Insert user baru
    const query = `INSERT INTO data_users (username, password, role, fullName) VALUES (?, ?, ?, ?)`;
    db.run(query, [username, password, role, fullName], function(err) {
      if (err) return res.status(500).json({ success: false, message: 'Gagal membuat akun' });
      res.json({ success: true, message: 'Akun berhasil didaftarkan!' });
    });
  });
});

// --- API UPDATE USER (SUPERADMIN ONLY) ---
app.put('/api/users/:rowNum', (req, res) => {
  const rowNum = req.params.rowNum;
  const { username, password, role, fullName } = req.body;

  if (!username || !password || !role || !fullName) {
    return res.status(400).json({ success: false, message: 'Semua kolom wajib diisi!' });
  }

  // Cek apakah username sudah digunakan oleh user lain
  db.get(`SELECT rowid FROM data_users WHERE username = ? AND rowid != ?`, [username, rowNum], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: 'Internal Server Error' });
    if (row) return res.status(400).json({ success: false, message: 'Username sudah digunakan oleh akun lain!' });

    const query = `UPDATE data_users SET username = ?, password = ?, role = ?, fullName = ? WHERE rowid = ?`;
    db.run(query, [username, password, role, fullName, rowNum], function(err) {
      if (err) return res.status(500).json({ success: false, message: 'Gagal memperbarui data pengguna' });
      res.json({ success: true, message: 'Data pengguna berhasil diperbarui!' });
    });
  });
});

// --- API DELETE USER (SUPERADMIN ONLY) ---
app.delete('/api/users/:rowNum', (req, res) => {
  const rowNum = req.params.rowNum;
  db.run(`DELETE FROM data_users WHERE rowid = ?`, [rowNum], function(err) {
    if (err) return res.status(500).json({ success: false, message: 'Gagal menghapus pengguna' });
    res.json({ success: true, message: 'Akuna pengguna berhasil dihapus!' });
  });
});

app.get('/api/users', (req, res) => {
  db.all(`SELECT rowid AS rowNum, username, password, role, fullName FROM data_users ORDER BY rowid DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Gagal mengambil data pengguna' });
    res.json({ success: true, data: rows });
  });
});

// --- API AUTOCOMPLETE ---
app.get('/api/autocomplete', (req, res) => {
  const query = `SELECT lokasi, model, pn, description, yp, ys FROM data_master`;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json(rows);
  });
});

// --- API DATABASE MASTER ---
app.get('/api/database', (req, res) => {
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;
  const offset = (page - 1) * pageSize;

  let query = `SELECT rowid AS rowNum, lokasi, model, pn, pn1, description, yp, ys, total FROM data_master`;
  let countQuery = `SELECT COUNT(*) AS totalItems FROM data_master`;
  let params = [];

  if (search) {
    const searchFilter = ` WHERE LOWER(lokasi) LIKE ? OR LOWER(model) LIKE ? OR LOWER(pn) LIKE ? OR LOWER(description) LIKE ?`;
    query += searchFilter;
    countQuery += searchFilter;
    const likeParam = `%${search}%`;
    params = [likeParam, likeParam, likeParam, likeParam];
  }

  query += ` LIMIT ? OFFSET ?`;
  const queryParams = [...params, pageSize, offset];

  db.get(`SELECT COUNT(DISTINCT model) AS uniqueModels FROM data_master`, [], (errUnique, rowUnique) => {
    const uniqueModels = rowUnique ? rowUnique.uniqueModels : 0;
    db.get(countQuery, params, (errCount, rowCount) => {
      if (errCount) return res.status(500).json({ success: false, error: errCount.message });
      const totalItems = rowCount ? rowCount.totalItems : 0;
      const totalPages = Math.ceil(totalItems / pageSize);

      db.all(query, queryParams, (errData, rows) => {
        if (errData) return res.status(500).json({ success: false, error: errData.message });
        res.json({ success: true, data: rows, totalPages: totalPages, currentPage: page, totalItems: totalItems, uniqueModels: uniqueModels });
      });
    });
  });
});

app.post('/api/database', (req, res) => {
  const { lokasi, model, pn, pn1, description, yp, ys, total } = req.body;
  const ypVal = parseInt(yp) || 0;
  const ysVal = parseInt(ys) || 0;
  const totalVal = ypVal + ysVal;

  const query = `INSERT INTO data_master (lokasi, model, pn, pn1, description, yp, ys, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(query, [lokasi, model, pn, pn1, description, ypVal, ysVal, totalVal], function (err) {
    if (err) return res.status(500).json({ success: false, message: 'Gagal menambah data master' });
    res.json({ success: true, rowNum: this.lastID });
  });
});

app.put('/api/database/:rowNum', (req, res) => {
  const rowNum = req.params.rowNum;
  const { lokasi, model, pn, pn1, description, yp, ys } = req.body;
  const ypVal = parseInt(yp) || 0;
  const ysVal = parseInt(ys) || 0;
  const totalVal = ypVal + ysVal;

  const query = `UPDATE data_master SET lokasi = ?, model = ?, pn = ?, pn1 = ?, description = ?, yp = ?, ys = ?, total = ? WHERE rowid = ?`;
  db.run(query, [lokasi, model, pn, pn1, description, ypVal, ysVal, totalVal, rowNum], function(err) {
    if (err) return res.status(500).json({ success: false, message: 'Gagal memperbarui data master' });
    res.json({ success: true });
  });
});

app.delete('/api/database/:rowNum', (req, res) => {
  db.run(`DELETE FROM data_master WHERE rowid = ?`, [req.params.rowNum], function(err) {
    if (err) return res.status(500).json({ success: false, message: 'Gagal menghapus data master' });
    res.json({ success: true });
  });
});

// --- API HISTORY SC ---
app.get('/api/history', (req, res) => {
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;
  const offset = (page - 1) * pageSize;

  let query = `SELECT rowid AS rowNum, lokasi, model, pn, material, waktu, odf, yp, ys, in_out AS type, keterangan, no_ro AS noRo, picker, approval FROM data_history_sc`;
  let countQuery = `SELECT COUNT(*) AS totalItems FROM data_history_sc`;
  let params = [];

  if (search) {
    const searchFilter = ` WHERE LOWER(pn) LIKE ? OR LOWER(model) LIKE ? OR LOWER(lokasi) LIKE ? OR LOWER(keterangan) LIKE ? OR LOWER(no_ro) LIKE ? OR LOWER(picker) LIKE ? OR LOWER(approval) LIKE ?`;
    query += searchFilter;
    countQuery += searchFilter;
    const likeParam = `%${search}%`;
    params = [likeParam, likeParam, likeParam, likeParam, likeParam, likeParam, likeParam];
  }

  query += ` ORDER BY rowid DESC LIMIT ? OFFSET ?`;
  const queryParams = [...params, pageSize, offset];

  db.get(`SELECT SUM(yp + ys) AS totalIn FROM data_history_sc WHERE in_out = 'IN'`, [], (errIn, rowIn) => {
    const totalIn = rowIn ? (rowIn.totalIn || 0) : 0;
    db.get(`SELECT SUM(yp + ys) AS totalOut FROM data_history_sc WHERE in_out = 'OUT'`, [], (errOut, rowOut) => {
      const totalOut = rowOut ? (rowOut.totalOut || 0) : 0;
      db.get(countQuery, params, (errCount, rowCount) => {
        if (errCount) return res.status(500).json({ success: false, error: errCount.message });
        const totalItems = rowCount ? rowCount.totalItems : 0;
        
        db.all(query, queryParams, (errData, rows) => {
          if (errData) return res.status(500).json({ success: false, error: errData.message });
          res.json({ success: true, data: rows, totalPages: Math.ceil(totalItems / pageSize), currentPage: page, totalItems: totalItems, totalIn: totalIn, totalOut: totalOut });
        });
      });
    });
  });
});

app.put('/api/history/:rowNum', (req, res) => {
  const { lokasi, model, pn, material, waktu, odf, yp, ys, type, keterangan, noRo, picker, approval } = req.body;
  const query = `UPDATE data_history_sc SET lokasi = ?, model = ?, pn = ?, material = ?, waktu = ?, odf = ?, yp = ?, ys = ?, in_out = ?, keterangan = ?, no_ro = ?, picker = ?, approval = ? WHERE rowid = ?`;
  db.run(query, [lokasi, model, pn, material, waktu, odf, yp, ys, type, keterangan, noRo, picker, approval, req.params.rowNum], function(err) {
    if (err) return res.status(500).json({ success: false, message: 'Gagal memperbarui log history' });
    res.json({ success: true });
  });
});

app.delete('/api/history/:rowNum', (req, res) => {
  const rowNum = req.params.rowNum;

  db.get(`SELECT * FROM data_history_sc WHERE rowid = ?`, [rowNum], (err, item) => {
    if (err || !item) return res.status(504).json({ success: false, message: 'Data history tidak ditemukan' });

    const multiplier = (item.in_out === 'IN') ? -1 : 1;
    const ypChange = (item.yp || 0) * multiplier;
    const ysChange = (item.ys || 0) * multiplier;

    db.get(`SELECT rowid AS rowId, yp, ys FROM data_master WHERE pn = ? AND lokasi = ?`, [item.pn, item.lokasi], (errM, mRow) => {
      if (!mRow) {
          db.run(`DELETE FROM data_history_sc WHERE rowid = ?`, [rowNum], (errD) => {
            res.json({ success: true, message: 'History dihapus (master tidak ditemukan)' });
          });
          return;
      }

      const newYP = Math.max(0, mRow.yp + ypChange);
      const newYS = Math.max(0, mRow.ys + ysChange);
      const newTotal = newYP + newYS;

      db.run(`UPDATE data_master SET yp = ?, ys = ?, total = ? WHERE rowid = ?`, [newYP, newYS, newTotal, mRow.rowId], (errUp) => {
        if (errUp) return res.status(500).json({ success: false, message: 'Gagal update stok master' });

        db.run(`DELETE FROM data_history_sc WHERE rowid = ?`, [rowNum], (errD) => {
          if (errD) return res.status(500).json({ success: false, message: 'Gagal menghapus history' });
          res.json({ success: true });
        });
      });
    });
  });
});

// --- API PENDING SC ---
app.get('/api/pending', (req, res) => {
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;
  
  let query = `SELECT rowid AS rowNum, lokasi, model, pn, material, waktu, odf, yp, ys, in_out AS type, keterangan, no_ro AS noRo, status, picker FROM data_sc_pending`;
  let countQuery = `SELECT COUNT(*) AS totalItems FROM data_sc_pending`;
  let params = [];

  if (search) {
    const searchFilter = ` WHERE LOWER(pn) LIKE ? OR LOWER(model) LIKE ? OR LOWER(lokasi) LIKE ? OR LOWER(keterangan) LIKE ? OR LOWER(picker) LIKE ?`;
    query += searchFilter;
    countQuery += searchFilter;
    const likeParam = `%${search}%`;
    params = [likeParam, likeParam, likeParam, likeParam, likeParam];
  }

  query += ` ORDER BY rowid DESC LIMIT ? OFFSET ?`;

  db.get(countQuery, params, (errCount, rowCount) => {
    if (errCount) return res.status(500).json({ success: false, error: errCount.message });
    const totalItems = rowCount ? rowCount.totalItems : 0;
    
    db.all(query, [...params, pageSize, (page - 1) * pageSize], (errData, rows) => {
      if (errData) return res.status(500).json({ success: false, error: errData.message });
      res.json({ success: true, data: rows, totalPages: Math.ceil(totalItems / pageSize), currentPage: page, totalItems: totalItems });
    });
  });
});

app.delete('/api/pending/:rowNum', (req, res) => {
  db.run(`DELETE FROM data_sc_pending WHERE rowid = ?`, [req.params.rowNum], function(err) {
    if (err) return res.status(500).json({ success: false, message: 'Gagal membatalkan transaksi pending' });
    res.json({ success: true });
  });
});

// DIUBAH: Mendukung penyimpanan user approval yang dikirim dari UI frontend
app.post('/api/pending/approve/:rowNum', (req, res) => {
  const rowNum = req.params.rowNum;
  const { approvedBy } = req.body; // Nama peng-approve dari client

  db.get(`SELECT * FROM data_sc_pending WHERE rowid = ?`, [rowNum], (errPending, item) => {
    if (errPending || !item) return res.status(504).json({ success: false, message: 'Data pending tidak ditemukan' });

    db.get(`SELECT rowid AS rowId, yp, ys, total FROM data_master WHERE TRIM(pn) = TRIM(?) AND TRIM(lokasi) = TRIM(?)`, [item.pn, item.lokasi], (errM, mRow) => {
      if (errM) return res.status(500).json({ success: false, message: 'Kesalahan database saat mencari master' });
      if (!mRow) return res.status(500).json({ success: false, message: `Item master untuk PN: ${item.pn} di Lokasi: ${item.lokasi} tidak ditemukan (pastikan penulisan sama persis)` });

      const newYP = Math.max(0, mRow.yp - (item.yp || 0));
      const newYS = Math.max(0, mRow.ys - (item.ys || 0));
      const newTotal = newYP + newYS;

      db.run(`UPDATE data_master SET yp = ?, ys = ?, total = ? WHERE rowid = ?`, [newYP, newYS, newTotal, mRow.rowId], (errUp) => {
        if (errUp) return res.status(500).json({ success: false, message: 'Gagal memperbarui stok di master' });

        // Ditambahkan penyimpanan picker dan approval ke tabel history SC
        const insertHistory = `INSERT INTO data_history_sc (lokasi, model, pn, material, waktu, odf, yp, ys, in_out, keterangan, no_ro, status, picker, approval) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        db.run(insertHistory, [item.lokasi, item.model, item.pn, item.material, item.waktu, item.odf, item.yp, item.ys, item.in_out, item.keterangan, item.no_ro, 'APPROVED', item.picker || 'System', approvedBy || 'Admin'], (errHist) => {
          if (errHist) return res.status(500).json({ success: false, message: 'Gagal memindahkan ke log history' });

          db.run(`DELETE FROM data_sc_pending WHERE rowid = ?`, [rowNum], (errDel) => {
            if (errDel) return res.status(500).json({ success: false, message: 'Gagal menghapus list pending' });
            res.json({ success: true });
          });
        });
      });
    });
  });
});

// --- API TRANSAKSI BATCH ---
app.post('/api/transactions/batch', async (req, res) => {
  const { items, picker } = req.body; // Mengambil items dan data picker (penginput) dari body request
  const transactionItems = items || req.body; // Fallback jika client mengirim array langsung
  const defaultPicker = picker || 'System';

  if (!transactionItems || transactionItems.length === 0) return res.status(400).json({ success: false, message: 'Item transaksi kosong' });

  const formatWaktu = () => {
    const d = new Date();
    const tgl = String(d.getDate()).padStart(2, '0');
    const bln = String(d.getMonth() + 1).padStart(2, '0');
    return `${tgl}/${bln}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  const waktuSekarang = formatWaktu();
  let errors = [];

  for (const item of transactionItems) {
    await new Promise((resolve) => {
      const ypVal = parseInt(item.yp) || 0;
      const ysVal = parseInt(item.ys) || 0;
      const itemPicker = item.picker || defaultPicker; // Menangani picker per item atau global

      if (item.type === 'IN') {
        db.get(`SELECT rowid AS rowId, yp, ys FROM data_master WHERE pn = ? AND lokasi = ?`, [item.pn, item.lokasi], (err, mRow) => {
          if (err) { errors.push(`DB Error: ${err.message}`); return resolve(); }
          
          if (mRow) {
            db.run(`UPDATE data_master SET yp = ?, ys = ?, total = ? WHERE rowid = ?`, [mRow.yp + ypVal, mRow.ys + ysVal, mRow.yp + ypVal + mRow.ys + ysVal, mRow.rowId], (errUp) => {
              if (errUp) { errors.push(`Gagal update master: ${errUp.message}`); return resolve(); }
              
              // Masuk ke history langsung ter-APPROVED, picker terekam, approval diisi "AUTO" karena barang IN tidak butuh approval manual
              db.run(`INSERT INTO data_history_sc (lokasi, model, pn, material, waktu, odf, yp, ys, in_out, keterangan, no_ro, status, picker, approval) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [item.lokasi, item.model, item.pn, item.material, waktuSekarang, item.odf, ypVal, ysVal, 'IN', item.keterangan, item.noRo, 'APPROVED', itemPicker, 'AUTO'], (errHist) => {
                  if (errHist) errors.push(`Gagal insert history IN: ${errHist.message}`);
                  resolve();
                });
            });
          } else {
            db.run(`INSERT INTO data_master (lokasi, model, pn, description, yp, ys, total) VALUES (?, ?, ?, ?, ?, ?, ?)`, [item.lokasi, item.model, item.pn, item.material, ypVal, ysVal, ypVal + ysVal], (errIns) => {
              if (errIns) { errors.push(`Gagal insert master baru: ${errIns.message}`); return resolve(); }
              
              db.run(`INSERT INTO data_history_sc (lokasi, model, pn, material, waktu, odf, yp, ys, in_out, keterangan, no_ro, status, picker, approval) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [item.lokasi, item.model, item.pn, item.material, waktuSekarang, item.odf, ypVal, ysVal, 'IN', item.keterangan, item.noRo, 'APPROVED', itemPicker, 'AUTO'], (errHist) => {
                  if (errHist) errors.push(`Gagal insert history IN (baru): ${errHist.message}`);
                  resolve();
                });
            });
          }
        });
      } else {
        // Masuk ke list Pending dengan menyertakan picker dari akun penginput
        db.run(`INSERT INTO data_sc_pending (lokasi, model, pn, material, waktu, odf, yp, ys, in_out, keterangan, no_ro, status, picker) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [item.lokasi, item.model, item.pn, item.material, waktuSekarang, item.odf, ypVal, ysVal, 'OUT', item.keterangan, item.noRo, 'PROSES', itemPicker], function(errPend) {
             if (errPend) {
                 errors.push(`Gagal memproses barang OUT (PN: ${item.pn}): ${errPend.message}`);
             }
             resolve();
          });
      }
    });
  }
  
  if (errors.length > 0) res.status(500).json({ success: false, message: errors.join('. ') });
  else res.json({ success: true });
});

// --- API CHART & DRILLDOWN ---
app.get('/api/chart-summary', (req, res) => {
  db.all(`SELECT keterangan, COUNT(*) AS count FROM data_history_sc GROUP BY keterangan`, [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    const summary = {};
    rows.forEach(r => { if (r.keterangan) summary[r.keterangan] = r.count; });
    res.json(summary);
  });
});

app.get('/api/drilldown', (req, res) => {
  const keterangan = req.query.keterangan;
  db.all(`SELECT lokasi, model, pn, material, waktu, yp, ys FROM data_history_sc WHERE keterangan = ? ORDER BY rowid DESC LIMIT 30`, [keterangan], (errLogs, logsRows) => {
    db.all(`SELECT material, SUM(yp) AS totalYP, SUM(ys) AS totalYS FROM data_history_sc WHERE keterangan = ? GROUP BY material`, [keterangan], (errGroups, groupsRows) => {
      const materialGroups = {};
      groupsRows.forEach(g => { materialGroups[g.material || '-'] = { yp: g.totalYP || 0, ys: g.totalYS || 0 }; });
      res.json({ recentLogs: logsRows, materialGroups: materialGroups });
    });
  });
});

app.get('/api/item-history', (req, res) => {
  db.all(`SELECT waktu, in_out AS type, yp, ys, keterangan, no_ro AS noRo FROM data_history_sc WHERE pn = ? AND lokasi = ? ORDER BY rowid DESC LIMIT 20`, [req.query.pn, req.query.lokasi], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json(rows);
  });
});

// --- API BACKUP ---
app.get('/api/backup', (req, res) => {
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;
  
  let query = `SELECT rowid AS rowNum, lokasi, model, pn, material, waktu, odf, yp, ys, in_out AS type, keterangan, no_ro AS noRo FROM data_backup_history_25_26`;
  let countQuery = `SELECT COUNT(*) AS totalItems FROM data_backup_history_25_26`;
  let params = [];

  if (search) {
    const searchFilter = ` WHERE LOWER(pn) LIKE ? OR LOWER(model) LIKE ? OR LOWER(no_ro) LIKE ?`;
    query += searchFilter;
    countQuery += searchFilter;
    const likeParam = `%${search}%`;
    params = [likeParam, likeParam, likeParam];
  }

  query += ` ORDER BY rowid DESC LIMIT ? OFFSET ?`;

  db.get(countQuery, params, (errCount, rowCount) => {
    // Handling error jika table tidak ada untuk mencegah server crash
    if (errCount) return res.json({ success: true, data: [], totalPages: 0, currentPage: 1, totalItems: 0 }); 

    db.all(query, [...params, pageSize, (page - 1) * pageSize], (errData, rows) => {
      res.json({ success: true, data: rows || [], totalPages: Math.ceil((rowCount?.totalItems || 0) / pageSize), currentPage: page, totalItems: rowCount?.totalItems || 0 });
    });
  });
});

app.get('/api/backup/export', (req, res) => {
  db.all(`SELECT lokasi, model, pn, material, waktu, odf, yp, ys, in_out AS type, keterangan, no_ro AS noRo FROM data_history_sc ORDER BY rowid DESC LIMIT 5000`, [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json(rows);
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server aktif menggunakan SQLite di port http://localhost:${PORT}`);
});