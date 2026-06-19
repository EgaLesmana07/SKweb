require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// MENGHUBUNGKAN KE DATABASE SUPABASE
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ ERROR: SUPABASE_URL atau SUPABASE_KEY tidak ditemukan di file .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log('✅ Terhubung sukses ke Cloud Database Supabase!');

// Pengaturan batas payload JSON diperbesar hingga 10mb untuk memfasilitasi import data massal
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));

// Route Utama (Landing Page)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// --- API OTENTIKASI & MANAJEMEN USER ---
// ==========================================

// API LOGIN USER
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const { data, error } = await supabase
      .from('data_users')
      .select('*')
      .eq('username', username)
      .eq('password', password)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.json({ success: false, message: 'Username atau Password salah!' });
    }
    res.json({ success: true, role: data.role, fullName: data.fullName, username: data.username });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem saat login', error: err.message });
  }
});

// API REGISTER PENGGUNA BARU (SUPERADMIN ONLY)
app.post('/api/register', async (req, res) => {
  const { username, password, role, fullName } = req.body;
  
  if (!username || !password || !role || !fullName) {
      return res.status(400).json({ success: false, message: 'Semua kolom wajib diisi!' });
  }

  try {
    // Cek duplikasi username
    const { data: existingUser, error: checkError } = await supabase
      .from('data_users')
      .select('username')
      .eq('username', username)
      .maybeSingle();

    if (checkError) throw checkError;

    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Username sudah digunakan, silakan pilih yang lain!' });
    }

    const { error: insertError } = await supabase
      .from('data_users')
      .insert([{ username, password, role, fullName }]);

    if (insertError) throw insertError;

    res.json({ success: true, message: 'Akun berhasil didaftarkan!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal membuat akun', error: err.message });
  }
});

// API MEMPERBARUI INFORMASI USER
app.put('/api/users/:rowNum', async (req, res) => {
  const rowNum = req.params.rowNum;
  const { username, password, role, fullName } = req.body;

  if (!username || !password || !role || !fullName) {
    return res.status(400).json({ success: false, message: 'Semua kolom wajib diisi!' });
  }

  try {
    // Periksa apakah username baru sudah digunakan oleh akun lain
    const { data: existingUser, error: checkError } = await supabase
      .from('data_users')
      .select('id')
      .eq('username', username)
      .neq('id', rowNum)
      .maybeSingle();

    if (checkError) throw checkError;

    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Username sudah digunakan oleh akun lain!' });
    }

    const { error: updateError } = await supabase
      .from('data_users')
      .update({ username, password, role, fullName })
      .eq('id', rowNum);

    if (updateError) throw updateError;

    res.json({ success: true, message: 'Data pengguna berhasil diperbarui!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memperbarui data pengguna', error: err.message });
  }
});

// API MENGHAPUS USER
app.delete('/api/users/:rowNum', async (req, res) => {
  try {
    const { error } = await supabase
      .from('data_users')
      .delete()
      .eq('id', req.params.rowNum);

    if (error) throw error;
    res.json({ success: true, message: 'Akun pengguna berhasil dihapus!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menghapus pengguna', error: err.message });
  }
});

// API MENDAPATKAN SEMUA DAFTAR USER
app.get('/api/users', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('data_users')
      .select('id, username, password, role, fullName')
      .order('id', { ascending: false });

    if (error) throw error;
    
    const formattedData = data.map(u => ({ ...u, rowNum: u.id }));
    res.json({ success: true, data: formattedData });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data pengguna', error: err.message });
  }
});

// ==========================================
// --- API AUTOCOMPLETE & DATABASE MASTER ---
// ==========================================

// API AUTOCOMPLETE (Mengambil Seluruh Data Master dengan Pembatasan Range Supabase)
app.get('/api/autocomplete', async (req, res) => {
  let allData = [];
  let pageNum = 0;
  const limitVal = 1000;

  try {
    while (true) {
      const { data: chunk, error } = await supabase
        .from('data_master')
        .select('lokasi, model, pn, description, yp, ys')
        .range(pageNum * limitVal, (pageNum + 1) * limitVal - 1);

      if (error) throw error;
      if (!chunk || chunk.length === 0) break;
      
      allData = allData.concat(chunk);
      if (chunk.length < limitVal) break;
      pageNum++;
    }
    res.json(allData);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data autocomplete', error: err.message });
  }
});

// API READ DATABASE MASTER (Dengan Fitur Pencarian & Pagination)
app.get('/api/database', async (req, res) => {
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;
  const offset = (page - 1) * pageSize;

  try {
    let query = supabase.from('data_master').select('*', { count: 'exact' });

    if (search) {
      query = query.or(`lokasi.ilike.%${search}%,model.ilike.%${search}%,pn.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data, count, error } = await query
      .range(offset, offset + pageSize - 1)
      .order('id', { ascending: false });

    if (error) throw error;

    // Menghitung Jumlah Model Unik secara keseluruhan
    let allModels = [];
    let pageNum = 0;
    const limitVal = 1000;
    while (true) {
      const { data: chunk, error: chunkErr } = await supabase
        .from('data_master')
        .select('model')
        .range(pageNum * limitVal, (pageNum + 1) * limitVal - 1);
      
      if (chunkErr) throw chunkErr;
      if (!chunk || chunk.length === 0) break;
      
      allModels = allModels.concat(chunk.map(item => item.model));
      if (chunk.length < limitVal) break;
      pageNum++;
    }
    const uniqueModels = new Set(allModels.filter(Boolean)).size;

    const formattedData = data.map(d => ({ ...d, rowNum: d.id }));
    res.json({ 
      success: true, 
      data: formattedData, 
      totalPages: Math.ceil(count / pageSize), 
      currentPage: page, 
      totalItems: count, 
      uniqueModels 
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API BATCH IMPORT DATABASE MASTER DARI FILE CSV
app.post('/api/database/batch', async (req, res) => {
  const { items } = req.body;
  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Data CSV kosong atau tidak valid!' });
  }

  try {
    const recordsToInsert = [];
    const recordsToUpdate = [];

    for (const item of items) {
      const lokasi = item.lokasi || '';
      const model = item.model || '';
      const pn = item.pn || '';
      const pn1 = item.pn1 || '';
      const description = item.description || '';
      const ypVal = parseInt(item.yp) || 0;
      const ysVal = parseInt(item.ys) || 0;
      const totalVal = ypVal + ysVal;

      if (!pn) continue;

      // Memeriksa keberadaan data lama di Supabase dengan kombinasi PN dan Lokasi
      const { data: existingItem, error: checkError } = await supabase
        .from('data_master')
        .select('id, yp, ys')
        .eq('pn', pn)
        .eq('lokasi', lokasi)
        .maybeSingle();

      if (checkError) throw checkError;

      if (existingItem) {
        recordsToUpdate.push({
          id: existingItem.id,
          lokasi,
          model,
          pn,
          pn1,
          description,
          yp: ypVal,
          ys: ysVal,
          total: totalVal
        });
      } else {
        recordsToInsert.push({
          lokasi,
          model,
          pn,
          pn1,
          description,
          yp: ypVal,
          ys: ysVal,
          total: totalVal
        });
      }
    }

    // Melakukan Insert massal jika ada records baru
    if (recordsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('data_master')
        .insert(recordsToInsert);
      
      if (insertError) throw insertError;
    }

    // Memperbarui records yang sudah ada secara sekuensial
    if (recordsToUpdate.length > 0) {
      for (const record of recordsToUpdate) {
        const { error: updateError } = await supabase
          .from('data_master')
          .update({
            model: record.model,
            pn1: record.pn1,
            description: record.description,
            yp: record.yp,
            ys: record.ys,
            total: record.total
          })
          .eq('id', record.id);

        if (updateError) throw updateError;
      }
    }

    res.json({ 
      success: true, 
      message: 'Batch Import Database Master berhasil!', 
      count: recordsToInsert.length + recordsToUpdate.length,
      inserted: recordsToInsert.length,
      updated: recordsToUpdate.length
    });

  } catch (error) {
    console.error("Batch Database Master Error:", error);
    res.status(500).json({ success: false, message: 'Gagal mengimpor database master', error: error.message });
  }
});

// API TAMBAH DATA DATABASE MASTER SECARA MANUAL
app.post('/api/database', async (req, res) => {
  const { lokasi, model, pn, pn1, description, yp, ys } = req.body;
  const ypVal = parseInt(yp) || 0;
  const ysVal = parseInt(ys) || 0;

  try {
    const { data, error } = await supabase
      .from('data_master')
      .insert([{ lokasi, model, pn, pn1, description, yp: ypVal, ys: ysVal, total: ypVal + ysVal }])
      .select('id')
      .single();

    if (error) throw error;
    res.json({ success: true, rowNum: data.id });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menambah data master', error: err.message });
  }
});

// API MEMPERBARUI SATU DATA MASTER
app.put('/api/database/:rowNum', async (req, res) => {
  const { lokasi, model, pn, pn1, description, yp, ys } = req.body;
  const ypVal = parseInt(yp) || 0;
  const ysVal = parseInt(ys) || 0;

  try {
    const { error } = await supabase
      .from('data_master')
      .update({ lokasi, model, pn, pn1, description, yp: ypVal, ys: ysVal, total: ypVal + ysVal })
      .eq('id', req.params.rowNum);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memperbarui data master', error: err.message });
  }
});

// API MENGHAPUS SATU DATA MASTER
app.delete('/api/database/:rowNum', async (req, res) => {
  try {
    const { error } = await supabase
      .from('data_master')
      .delete()
      .eq('id', req.params.rowNum);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menghapus data master', error: err.message });
  }
});


// ==========================================
// --- API HISTORY SC (RIWAYAT KARTU STOK) ---
// ==========================================

// API READ HISTORY SC
app.get('/api/history', async (req, res) => {
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;
  const offset = (page - 1) * pageSize;

  try {
    let query = supabase.from('data_history_sc').select('*', { count: 'exact' });

    if (search) {
      query = query.or(`pn.ilike.%${search}%,model.ilike.%${search}%,lokasi.ilike.%${search}%,keterangan.ilike.%${search}%,no_ro.ilike.%${search}%,picker.ilike.%${search}%,approval.ilike.%${search}%`);
    }

    const { data, count, error } = await query
      .range(offset, offset + pageSize - 1)
      .order('id', { ascending: false });

    if (error) throw error;

    // Mengambil jumlah total barang masuk (IN) dan keluar (OUT)
    const { count: totalIn } = await supabase
      .from('data_history_sc')
      .select('*', { count: 'exact', head: true })
      .eq('in_out', 'IN');

    const { count: totalOut } = await supabase
      .from('data_history_sc')
      .select('*', { count: 'exact', head: true })
      .eq('in_out', 'OUT');

    const formattedData = data.map(d => ({ 
      ...d, 
      rowNum: d.id, 
      type: d.in_out, 
      noRo: d.no_ro,
      waktu: d.waktu ? new Date(d.waktu).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-'
    }));

    res.json({ 
      success: true, 
      data: formattedData, 
      totalPages: Math.ceil(count / pageSize), 
      currentPage: page, 
      totalItems: count, 
      totalIn: totalIn || 0, 
      totalOut: totalOut || 0 
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API EDIT LOG TRANSAKSI HISTORY
app.put('/api/history/:rowNum', async (req, res) => {
  const { lokasi, model, pn, material, waktu, odf, yp, ys, type, keterangan, noRo, picker, approval } = req.body;
  
  try {
    const { error } = await supabase
      .from('data_history_sc')
      .update({ 
        lokasi, model, pn, material, waktu, odf, 
        yp: Number(yp)||0, ys: Number(ys)||0, in_out: type, keterangan, no_ro: noRo, picker, approval 
      })
      .eq('id', req.params.rowNum);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memperbarui log history', error: err.message });
  }
});

// API DELETE LOG TRANSAKSI HISTORY (Mengembalikan stok ke Master secara dinamis)
app.delete('/api/history/:rowNum', async (req, res) => {
  const rowNum = req.params.rowNum;

  try {
    // Ambil detail log history yang akan dihapus
    const { data: item, error: errItem } = await supabase
      .from('data_history_sc')
      .select('*')
      .eq('id', rowNum)
      .single();

    if (errItem || !item) return res.status(504).json({ success: false, message: 'Data history tidak ditemukan' });

    // Jika IN dibatalkan maka stok berkurang, jika OUT dibatalkan maka stok bertambah
    const multiplier = (item.in_out === 'IN') ? -1 : 1;
    const ypChange = (Number(item.yp) || 0) * multiplier;
    const ysChange = (Number(item.ys) || 0) * multiplier;

    // Ambil data master untuk disinkronisasi kembali
    const { data: mRow } = await supabase
      .from('data_master')
      .select('id, yp, ys')
      .eq('pn', item.pn)
      .eq('lokasi', item.lokasi)
      .maybeSingle();

    if (mRow) {
      const newYP = Math.max(0, Number(mRow.yp) + ypChange);
      const newYS = Math.max(0, Number(mRow.ys) + ysChange);
      await supabase
        .from('data_master')
        .update({ yp: newYP, ys: newYS, total: newYP + newYS })
        .eq('id', mRow.id);
    }

    const { error: deleteError } = await supabase.from('data_history_sc').delete().eq('id', rowNum);
    if (deleteError) throw deleteError;

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menghapus log transaksi', error: err.message });
  }
});

// ==========================================
// --- API SC PENDING (PROSES OUT) ---
// ==========================================

// API READ PENDING LIST
app.get('/api/pending', async (req, res) => {
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;
  const offset = (page - 1) * pageSize;

  try {
    let query = supabase.from('data_sc_pending').select('*', { count: 'exact' });

    if (search) {
      query = query.or(`pn.ilike.%${search}%,model.ilike.%${search}%,lokasi.ilike.%${search}%,keterangan.ilike.%${search}%,picker.ilike.%${search}%`);
    }

    const { data, count, error } = await query
      .range(offset, offset + pageSize - 1)
      .order('id', { ascending: false });

    if (error) throw error;

    const formattedData = data.map(d => ({ 
      ...d, 
      rowNum: d.id, 
      type: d.in_out, 
      noRo: d.no_ro,
      waktu: d.waktu ? new Date(d.waktu).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-'
    }));

    res.json({ success: true, data: formattedData, totalPages: Math.ceil(count / pageSize), currentPage: page, totalItems: count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API CANCEL / DELETE PENDING TRANSACTION
app.delete('/api/pending/:rowNum', async (req, res) => {
  try {
    const { error } = await supabase
      .from('data_sc_pending')
      .delete()
      .eq('id', req.params.rowNum);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal membatalkan transaksi pending', error: err.message });
  }
});

// API APPROVE PENDING OUT (Mengurangi stok master, memindahkan log ke History SC)
app.post('/api/pending/approve/:rowNum', async (req, res) => {
  const rowNum = req.params.rowNum;
  const { approvedBy } = req.body; 

  try {
    // Ambil data pending yang akan disetujui
    const { data: item, error: errPending } = await supabase
      .from('data_sc_pending')
      .select('*')
      .eq('id', rowNum)
      .single();

    if (errPending || !item) {
      return res.status(504).json({ success: false, message: 'Data pending tidak ditemukan' });
    }

    // Ambil data master untuk memeriksa ketersediaan stok
    const { data: mRow, error: errM } = await supabase
      .from('data_master')
      .select('id, yp, ys')
      .eq('pn', item.pn)
      .eq('lokasi', item.lokasi)
      .maybeSingle();

    if (errM || !mRow) {
      return res.status(500).json({ success: false, message: `Item master untuk PN: ${item.pn} di Lokasi: ${item.lokasi} tidak ditemukan` });
    }

    const newYP = Math.max(0, Number(mRow.yp) - (Number(item.yp) || 0));
    const newYS = Math.max(0, Number(mRow.ys) - (Number(item.ys) || 0));
    const newTotal = newYP + newYS;

    // Perbarui stok di database master
    const { error: errUp } = await supabase
      .from('data_master')
      .update({ yp: newYP, ys: newYS, total: newTotal })
      .eq('id', mRow.id);

    if (errUp) throw errUp;

    // Pindahkan log ke data_history_sc dengan status APPROVED
    const { error: errHist } = await supabase
      .from('data_history_sc')
      .insert([{
        lokasi: item.lokasi, model: item.model, pn: item.pn, material: item.material, waktu: item.waktu, 
        odf: item.odf, yp: item.yp, ys: item.ys, in_out: item.in_out, keterangan: item.keterangan, 
        no_ro: item.no_ro, status: 'APPROVED', picker: item.picker || 'System', approval: approvedBy || 'Admin'
      }]);

    if (errHist) throw errHist;

    // Hapus data dari daftar pending
    await supabase.from('data_sc_pending').delete().eq('id', rowNum);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal meng-approve transaksi', error: err.message });
  }
});


// ==========================================
// --- API INPUT TRANSAKSI BATCH (IN/OUT) ---
// ==========================================

app.post('/api/transactions/batch', async (req, res) => {
  const { items, picker } = req.body; 
  const transactionItems = items || req.body; 
  const defaultPicker = picker || 'System';

  if (!transactionItems || transactionItems.length === 0) {
    return res.status(400).json({ success: false, message: 'Item transaksi kosong' });
  }

  const waktuSekarang = new Date().toISOString();
  let errors = [];

  try {
    for (const item of transactionItems) {
      const ypVal = parseInt(item.yp) || 0;
      const ysVal = parseInt(item.ys) || 0;
      const itemPicker = item.picker || defaultPicker; 

      if (item.type === 'IN') {
        const { data: mRow, error: findError } = await supabase
          .from('data_master')
          .select('id, yp, ys')
          .eq('pn', item.pn)
          .eq('lokasi', item.lokasi)
          .maybeSingle();

        if (findError) throw findError;

        if (mRow) {
          // Tambahkan stok master secara langsung untuk transaksi IN
          const newYP = Number(mRow.yp) + ypVal;
          const newYS = Number(mRow.ys) + ysVal;
          await supabase
            .from('data_master')
            .update({ yp: newYP, ys: newYS, total: newYP + newYS })
            .eq('id', mRow.id);

          // Masuk ke log history utama secara otomatis dengan status APPROVED
          await supabase
            .from('data_history_sc')
            .insert([{
              lokasi: item.lokasi, model: item.model, pn: item.pn, material: item.material, waktu: waktuSekarang, 
              odf: item.odf, yp: ypVal, ys: ysVal, in_out: 'IN', keterangan: item.keterangan, 
              no_ro: item.noRo, status: 'APPROVED', picker: itemPicker, approval: 'AUTO'
            }]);
        } else {
          errors.push(`Gagal IN: PN '${item.pn}' di Lokasi '${item.lokasi}' tidak terdaftar di Database Master.`);
        }
      } else {
        // Transaksi OUT masuk ke seksi pending terlebih dahulu menunggu persetujuan Admin
        await supabase
          .from('data_sc_pending')
          .insert([{
            lokasi: item.lokasi, model: item.model, pn: item.pn, material: item.material, waktu: waktuSekarang, 
            odf: item.odf, yp: ypVal, ys: ysVal, in_out: 'OUT', keterangan: item.keterangan, 
            no_ro: item.noRo, status: 'PROSES', picker: itemPicker
          }]);
      }
    }
    
    if (errors.length > 0) {
      res.status(500).json({ success: false, message: errors.join('. ') });
    } else {
      res.json({ success: true });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memproses batch transaksi', error: err.message });
  }
});


// ==========================================
// --- API GRAFIK & ANALISA ---
// ==========================================

// REKAP KATEGORI PERGERAKAN UNTUK BAGIAN CHART DOUGHNUT
app.get('/api/chart-summary', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('data_history_sc')
      .select('keterangan');

    if (error) throw error;
    
    const summary = {};
    data.forEach(r => { 
      if (r.keterangan) {
        summary[r.keterangan] = (summary[r.keterangan] || 0) + 1;
      }
    });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DETAIL DRILLDOWN KATEGORI KETIKA IRISAN GRAFIK DIKLIK
app.get('/api/drilldown', async (req, res) => {
  const keterangan = req.query.keterangan;
  
  try {
    const { data: logsRows, error: errLogs } = await supabase
      .from('data_history_sc')
      .select('lokasi, model, pn, material, waktu, yp, ys')
      .eq('keterangan', keterangan)
      .order('id', { ascending: false })
      .limit(30);

    if (errLogs) throw errLogs;

    const { data: allGroupData, error: errGroup } = await supabase
      .from('data_history_sc')
      .select('material, yp, ys')
      .eq('keterangan', keterangan);

    if (errGroup) throw errGroup;

    const materialGroups = {};
    (allGroupData || []).forEach(g => {
      const mat = g.material || '-';
      if (!materialGroups[mat]) materialGroups[mat] = { yp: 0, ys: 0 };
      materialGroups[mat].yp += (Number(g.yp) || 0);
      materialGroups[mat].ys += (Number(g.ys) || 0);
    });

    const formattedLogs = (logsRows || []).map(d => ({ 
      ...d, 
      waktu: d.waktu ? new Date(d.waktu).toLocaleString('id-ID') : '-' 
    }));

    res.json({ recentLogs: formattedLogs, materialGroups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// RIWAYAT TRANSAKSI SPESIFIK ITEM DI DATABASE MASTER
app.get('/api/item-history', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('data_history_sc')
      .select('waktu, in_out, yp, ys, keterangan, no_ro')
      .eq('pn', req.query.pn)
      .eq('lokasi', req.query.lokasi)
      .order('id', { ascending: false })
      .limit(20);

    if (error) throw error;

    const formatted = (data || []).map(d => ({
      waktu: d.waktu ? new Date(d.waktu).toLocaleString('id-ID') : '-',
      type: d.in_out,
      yp: d.yp,
      ys: d.ys,
      keterangan: d.keterangan,
      noRo: d.no_ro
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ==========================================
// --- API BACKUP DATA (2025 - 2026) ---
// ==========================================

app.get('/api/backup', async (req, res) => {
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;
  const offset = (page - 1) * pageSize;

  try {
    let query = supabase.from('data_backup_history_25_26').select('*', { count: 'exact' });

    if (search) {
      query = query.or(`pn.ilike.%${search}%,model.ilike.%${search}%,no_ro.ilike.%${search}%`);
    }

    const { data, count, error } = await query
      .range(offset, offset + pageSize - 1)
      .order('id', { ascending: false });
    
    if (error) throw error;

    const formattedData = (data || []).map(d => ({ 
      ...d, 
      rowNum: d.id, 
      type: d.in_out, 
      noRo: d.no_ro,
      waktu: d.waktu ? new Date(d.waktu).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-'
    }));

    res.json({ success: true, data: formattedData, totalPages: Math.ceil(count / pageSize), currentPage: page, totalItems: count });
  } catch (err) {
    res.json({ success: true, data: [], totalPages: 0, currentPage: 1, totalItems: 0, error: err.message });
  }
});

// START EXPRESS SERVER
app.listen(PORT, () => {
  console.log(`🚀 Server aktif menggunakan Supabase di port http://localhost:${PORT}`);
});

module.exports = app;