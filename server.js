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

// API AUTOCOMPLETE (Mengambil Master Data dan Kalkulasi Pending)
app.get('/api/autocomplete', async (req, res) => {
  let allData = [];
  let pageNum = 0;
  const limitVal = 1000;

  try {
    while (true) {
      const { data: chunk, error } = await supabase
        .from('data_master')
        .select('id, lokasi, model, pn, description, yp, ys')
        .range(pageNum * limitVal, (pageNum + 1) * limitVal - 1);

      if (error) throw error;
      if (!chunk || chunk.length === 0) break;
      
      allData = allData.concat(chunk);
      if (chunk.length < limitVal) break;
      pageNum++;
    }

    const { data: pendingData, error: pendingError } = await supabase
        .from('data_sc_pending')
        .select('pn, lokasi, yp, ys');
    
    if (pendingError) throw pendingError;

    const pendingMap = {};
    if (pendingData) {
        pendingData.forEach(p => {
            const key = `${p.pn}_${p.lokasi}`;
            if (!pendingMap[key]) pendingMap[key] = { yp: 0, ys: 0 };
            pendingMap[key].yp += (parseInt(p.yp) || 0);
            pendingMap[key].ys += (parseInt(p.ys) || 0);
        });
    }

    const result = allData.map(item => {
        const key = `${item.pn}_${item.lokasi}`;
        const p = pendingMap[key] || { yp: 0, ys: 0 };
        return {
            ...item,
            pending_yp: p.yp,
            pending_ys: p.ys,
            available_yp: Math.max(0, (parseInt(item.yp) || 0) - p.yp),
            available_ys: Math.max(0, (parseInt(item.ys) || 0) - p.ys)
        };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data autocomplete', error: err.message });
  }
});

// API READ DATABASE MASTER
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

// API BATCH IMPORT DATABASE MASTER
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

    if (recordsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('data_master')
        .insert(recordsToInsert);
      
      if (insertError) throw insertError;
    }

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
    res.status(500).json({ success: false, message: 'Gagal mengimpor database master', error: error.message });
  }
});

// API TAMBAH DATA DATABASE MASTER
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


// ==============================================================
// BLOK API DELETE DATABASE MASTER (TELAH DIBERSIHKAN DARI DUPLIKAT)
// ==============================================================

// 1. API MENGHAPUS BANYAK DATA MASTER SEKALIGUS (BULK DELETE)
// HARUS DITETAPKAN LEBIH DULU DARI /:rowNum
app.delete('/api/database/bulk', async (req, res) => {
  const { ids } = req.body;
  
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada data yang dipilih untuk dihapus.' });
  }

  try {
    const numericIds = ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id));

    const { error } = await supabase
      .from('data_master')
      .delete()
      .in('id', numericIds);

    if (error) throw error;
    res.json({ success: true, message: `${numericIds.length} data berhasil dihapus dari Master Database!` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menghapus data massal', error: err.message });
  }
});

// 2. API MENGHAPUS SATU DATA MASTER
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
// ==============================================================


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

    const { count: totalIn } = await supabase.from('data_history_sc').select('*', { count: 'exact', head: true }).eq('in_out', 'IN');
    const { count: totalOut } = await supabase.from('data_history_sc').select('*', { count: 'exact', head: true }).eq('in_out', 'OUT');

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
  const rowNum = req.params.rowNum;
  const { lokasi, model, pn, material, odf, yp, ys, type, keterangan, noRo, picker, approval } = req.body;
  const newYP = Number(yp) || 0;
  const newYS = Number(ys) || 0;

  try {
    const { data: oldItem, error: errOld } = await supabase.from('data_history_sc').select('*').eq('id', rowNum).single();
    if (errOld || !oldItem) return res.status(404).json({ success: false, message: 'Data log history tidak ditemukan' });

    const oldMultiplier = (oldItem.in_out === 'IN') ? -1 : 1; 
    const revertYPChange = (Number(oldItem.yp) || 0) * oldMultiplier;
    const revertYSChange = (Number(oldItem.ys) || 0) * oldMultiplier;

    const { data: oldMaster } = await supabase.from('data_master').select('id, yp, ys').eq('pn', oldItem.pn).eq('lokasi', oldItem.lokasi).maybeSingle();
    
    if (oldMaster) {
      const revertYP = Math.max(0, Number(oldMaster.yp) + revertYPChange);
      const revertYS = Math.max(0, Number(oldMaster.ys) + revertYSChange);
      await supabase.from('data_master').update({ yp: revertYP, ys: revertYS, total: revertYP + revertYS }).eq('id', oldMaster.id);
    }

    const newMultiplier = (type === 'IN') ? 1 : -1; 
    const applyYPChange = newYP * newMultiplier;
    const applyYSChange = newYS * newMultiplier;

    const { data: newMaster } = await supabase.from('data_master').select('id, yp, ys').eq('pn', pn).eq('lokasi', lokasi).maybeSingle();
    
    if (newMaster) {
      const applyYP = Math.max(0, Number(newMaster.yp) + applyYPChange);
      const applyYS = Math.max(0, Number(newMaster.ys) + applyYSChange);
      await supabase.from('data_master').update({ yp: applyYP, ys: applyYS, total: applyYP + applyYS }).eq('id', newMaster.id);
    }

    const { error: updateError } = await supabase
      .from('data_history_sc')
      .update({ 
        lokasi, model, pn, material, odf, 
        yp: newYP, ys: newYS, in_out: type, keterangan, no_ro: noRo,
        ...(picker !== undefined && { picker }),
        ...(approval !== undefined && { approval })
      })
      .eq('id', rowNum);

    if (updateError) throw updateError;

    res.json({ success: true, message: 'Data history berhasil diperbarui!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memperbarui data', error: err.message });
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
    const { error } = await supabase.from('data_sc_pending').delete().eq('id', req.params.rowNum);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal membatalkan transaksi pending', error: err.message });
  }
});

// API APPROVE PENDING OUT
app.post('/api/pending/approve/:rowNum', async (req, res) => {
  const rowNum = req.params.rowNum;
  const { approvedBy } = req.body; 

  try {
    const { data: item, error: errPending } = await supabase.from('data_sc_pending').select('*').eq('id', rowNum).single();
    if (errPending || !item) return res.status(504).json({ success: false, message: 'Data pending tidak ditemukan' });

    const { data: mRow, error: errM } = await supabase.from('data_master').select('id, yp, ys').eq('pn', item.pn).eq('lokasi', item.lokasi).maybeSingle();
    if (errM || !mRow) return res.status(500).json({ success: false, message: `Item master untuk PN: ${item.pn} di Lokasi: ${item.lokasi} tidak ditemukan` });

    const reqYP = Number(item.yp) || 0;
    const reqYS = Number(item.ys) || 0;
    
    // Validasi stok master sebelum approve SC Pending (OUT)
    if (Number(mRow.yp) < reqYP) {
      return res.status(400).json({ success: false, message: `Stok YP di Master tidak mencukupi! (Tersedia: ${mRow.yp}, Dibutuhkan: ${reqYP})` });
    }
    if (Number(mRow.ys) < reqYS) {
      return res.status(400).json({ success: false, message: `Stok YS di Master tidak mencukupi! (Tersedia: ${mRow.ys}, Dibutuhkan: ${reqYS})` });
    }

    const newYP = Number(mRow.yp) - reqYP;
    const newYS = Number(mRow.ys) - reqYS;
    const newTotal = newYP + newYS;

    const { error: errUp } = await supabase.from('data_master').update({ yp: newYP, ys: newYS, total: newTotal }).eq('id', mRow.id);
    if (errUp) throw errUp;

    const { error: errHist } = await supabase.from('data_history_sc').insert([{
        lokasi: item.lokasi, model: item.model, pn: item.pn, material: item.material, waktu: item.waktu, 
        odf: item.odf, yp: item.yp, ys: item.ys, in_out: item.in_out, keterangan: item.keterangan, 
        no_ro: item.no_ro, status: 'APPROVED', picker: item.picker || 'System', approval: approvedBy || 'Admin'
      }]);
    if (errHist) throw errHist;

    await supabase.from('data_sc_pending').delete().eq('id', rowNum);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal meng-approve transaksi', error: err.message });
  }
});


// ==========================================
// --- API NG PENDING & HISTORY NG ---
// ==========================================

// API READ NG PENDING LIST
app.get('/api/ng-pending', async (req, res) => {
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;
  const offset = (page - 1) * pageSize;

  try {
    let query = supabase.from('data_ng_pending').select('*', { count: 'exact' });

    if (search) {
      query = query.or(`pn.ilike.%${search}%,model.ilike.%${search}%,lokasi.ilike.%${search}%,picker.ilike.%${search}%`);
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

// API CANCEL / DELETE NG PENDING
app.delete('/api/ng-pending/:rowNum', async (req, res) => {
  try {
    const { error } = await supabase.from('data_ng_pending').delete().eq('id', req.params.rowNum);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal membatalkan NG pending', error: err.message });
  }
});

// API EDIT NG PENDING
app.put('/api/ng-pending/:rowNum', async (req, res) => {
  const { odf, yp, ys, type, noRo } = req.body;
  try {
    const { error } = await supabase
      .from('data_ng_pending')
      .update({ odf, yp, ys, in_out: type, no_ro: noRo })
      .eq('id', req.params.rowNum);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal update NG pending', error: err.message });
  }
});

// API APPROVE NG PENDING
app.post('/api/ng-pending/approve/:rowNum', async (req, res) => {
  const rowNum = req.params.rowNum;
  const { approvedBy } = req.body; 

  try {
    const { data: item, error: errPending } = await supabase.from('data_ng_pending').select('*').eq('id', rowNum).single();
    if (errPending || !item) return res.status(404).json({ success: false, message: 'Data NG pending tidak ditemukan' });

    const { data: mRow, error: errM } = await supabase.from('data_master').select('id, yp, ys').eq('pn', item.pn).eq('lokasi', item.lokasi).maybeSingle();
    
    // Sesuaikan Logic IN/OUT terhadap stok Master saat Approve NG
    if (mRow) {
      let newYP = Number(mRow.yp);
      let newYS = Number(mRow.ys);
      
      if(item.in_out === 'OUT') {
        const reqYP = Number(item.yp) || 0;
        const reqYS = Number(item.ys) || 0;
        
        // Validasi stok master sebelum approve NG Pending (OUT)
        if (newYP < reqYP) {
          return res.status(400).json({ success: false, message: `Stok YP di Master tidak mencukupi! (Tersedia: ${newYP}, Dibutuhkan: ${reqYP})` });
        }
        if (newYS < reqYS) {
          return res.status(400).json({ success: false, message: `Stok YS di Master tidak mencukupi! (Tersedia: ${newYS}, Dibutuhkan: ${reqYS})` });
        }
        
        newYP = newYP - reqYP;
        newYS = newYS - reqYS;
      } else if (item.in_out === 'IN') {
        newYP = newYP + (Number(item.yp) || 0);
        newYS = newYS + (Number(item.ys) || 0);
      }
      
      await supabase.from('data_master').update({ yp: newYP, ys: newYS, total: newYP + newYS }).eq('id', mRow.id);
    } else {
      if (item.in_out === 'OUT') {
        return res.status(400).json({ success: false, message: 'Data Master tidak ditemukan untuk Lokasi dan PN ini. Approve OUT ditolak.' });
      }
    }

    // Insert ke History SC Master
    const { error: errHist } = await supabase.from('data_history_sc').insert([{
        lokasi: item.lokasi, model: item.model, pn: item.pn, material: item.material, waktu: item.waktu, 
        odf: item.odf, yp: item.yp, ys: item.ys, in_out: item.in_out, keterangan: item.keterangan, 
        no_ro: item.no_ro, status: 'APPROVED', picker: item.picker || 'System', approval: approvedBy || 'Admin'
    }]);
    if (errHist) throw errHist;

    // Insert ke Tabel Khusus History NG
    const { error: errHistNg } = await supabase.from('data_history_ng').insert([{
        lokasi: item.lokasi, model: item.model, pn: item.pn, material: item.material, waktu: item.waktu, 
        odf: item.odf, yp: item.yp, ys: item.ys, in_out: item.in_out, keterangan: item.keterangan, 
        no_ro: item.no_ro, picker: item.picker || 'System', approval: approvedBy || 'Admin'
    }]);
    if (errHistNg) throw errHistNg;

    await supabase.from('data_ng_pending').delete().eq('id', rowNum);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal meng-approve NG', error: err.message });
  }
});

// API READ HISTORY NG LIST
app.get('/api/history-ng', async (req, res) => {
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;
  const offset = (page - 1) * pageSize;

  try {
    let query = supabase.from('data_history_ng').select('*', { count: 'exact' });
    if (search) query = query.or(`pn.ilike.%${search}%,model.ilike.%${search}%,lokasi.ilike.%${search}%,picker.ilike.%${search}%`);
    const { data, count, error } = await query.range(offset, offset + pageSize - 1).order('id', { ascending: false });
    if (error) throw error;
    const formattedData = data.map(d => ({ ...d, rowNum: d.id, type: d.in_out, noRo: d.no_ro, waktu: d.waktu ? new Date(d.waktu).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-' }));
    res.json({ success: true, data: formattedData, totalPages: Math.ceil(count / pageSize), currentPage: page, totalItems: count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ==========================================
// --- API SHORTAGE PENDING & HISTORY SHORTAGE ---
// ==========================================

// API READ SHORTAGE PENDING LIST
app.get('/api/shortage-pending', async (req, res) => {
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;
  const offset = (page - 1) * pageSize;

  try {
    let query = supabase.from('data_shortage_pending').select('*', { count: 'exact' });

    if (search) {
      query = query.or(`pn.ilike.%${search}%,model.ilike.%${search}%,lokasi.ilike.%${search}%,picker.ilike.%${search}%`);
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

// API CANCEL / DELETE SHORTAGE PENDING
app.delete('/api/shortage-pending/:rowNum', async (req, res) => {
  try {
    const { error } = await supabase.from('data_shortage_pending').delete().eq('id', req.params.rowNum);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal membatalkan Shortage pending', error: err.message });
  }
});

// API EDIT SHORTAGE PENDING
app.put('/api/shortage-pending/:rowNum', async (req, res) => {
  const { odf, yp, ys, type, noRo } = req.body;
  try {
    const { error } = await supabase
      .from('data_shortage_pending')
      .update({ odf, yp, ys, in_out: type, no_ro: noRo })
      .eq('id', req.params.rowNum);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal update Shortage pending', error: err.message });
  }
});

// API APPROVE SHORTAGE PENDING
app.post('/api/shortage-pending/approve/:rowNum', async (req, res) => {
  const rowNum = req.params.rowNum;
  const { approvedBy } = req.body; 

  try {
    const { data: item, error: errPending } = await supabase.from('data_shortage_pending').select('*').eq('id', rowNum).single();
    if (errPending || !item) return res.status(404).json({ success: false, message: 'Data Shortage pending tidak ditemukan' });

    const { data: mRow, error: errM } = await supabase.from('data_master').select('id, yp, ys').eq('pn', item.pn).eq('lokasi', item.lokasi).maybeSingle();
    
    // Validasi stok master sebelum approve Shortage Pending
    if (mRow) {
      let newYP = Number(mRow.yp);
      let newYS = Number(mRow.ys);
      
      if(item.in_out === 'OUT') {
        const reqYP = Number(item.yp) || 0;
        const reqYS = Number(item.ys) || 0;
        
        // Cek kecukupan stok sebelum dikurangi
        if (newYP < reqYP) {
          return res.status(400).json({ success: false, message: `Stok YP di Master tidak mencukupi! (Tersedia: ${newYP}, Dibutuhkan: ${reqYP})` });
        }
        if (newYS < reqYS) {
          return res.status(400).json({ success: false, message: `Stok YS di Master tidak mencukupi! (Tersedia: ${newYS}, Dibutuhkan: ${reqYS})` });
        }
        
        newYP -= reqYP;
        newYS -= reqYS;
      } else if (item.in_out === 'IN') {
        newYP += (Number(item.yp) || 0);
        newYS += (Number(item.ys) || 0);
      }
      
      await supabase.from('data_master').update({ yp: newYP, ys: newYS, total: newYP + newYS }).eq('id', mRow.id);
    } else {
      // Jika data master belum ada, tidak bisa approve transaksi OUT
      if (item.in_out === 'OUT') {
        return res.status(400).json({ success: false, message: 'Data Master tidak ditemukan untuk Lokasi dan PN ini. Approve OUT ditolak.' });
      }
    }

    // Insert ke History SC Master
    const { error: errHist } = await supabase.from('data_history_sc').insert([{
        lokasi: item.lokasi, model: item.model, pn: item.pn, material: item.material, waktu: item.waktu, 
        odf: item.odf, yp: item.yp, ys: item.ys, in_out: item.in_out, keterangan: item.keterangan, 
        no_ro: item.no_ro, status: 'APPROVED', picker: item.picker || 'System', approval: approvedBy || 'Admin'
    }]);
    if (errHist) throw errHist;

    // Insert ke Tabel Khusus History Shortage
    const { error: errHistShortage } = await supabase.from('data_history_shortage').insert([{
        lokasi: item.lokasi, model: item.model, pn: item.pn, material: item.material, waktu: item.waktu, 
        odf: item.odf, yp: item.yp, ys: item.ys, in_out: item.in_out, keterangan: item.keterangan, 
        no_ro: item.no_ro, picker: item.picker || 'System', approval: approvedBy || 'Admin'
    }]);
    if (errHistShortage) throw errHistShortage;

    await supabase.from('data_shortage_pending').delete().eq('id', rowNum);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal meng-approve Shortage', error: err.message });
  }
});

// API READ HISTORY SHORTAGE LIST
app.get('/api/history-shortage', async (req, res) => {
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;
  const offset = (page - 1) * pageSize;

  try {
    let query = supabase.from('data_history_shortage').select('*', { count: 'exact' });
    if (search) query = query.or(`pn.ilike.%${search}%,model.ilike.%${search}%,lokasi.ilike.%${search}%,picker.ilike.%${search}%`);
    const { data, count, error } = await query.range(offset, offset + pageSize - 1).order('id', { ascending: false });
    if (error) throw error;
    const formattedData = data.map(d => ({ ...d, rowNum: d.id, type: d.in_out, noRo: d.no_ro, waktu: d.waktu ? new Date(d.waktu).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-' }));
    res.json({ success: true, data: formattedData, totalPages: Math.ceil(count / pageSize), currentPage: page, totalItems: count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ==========================================
// --- API BULK ACTIONS (APPROVE & DELETE) ---
// ==========================================

// API BULK DELETE (Global untuk Pending & History)
app.post('/api/bulk-delete', async (req, res) => {
  const { table, ids } = req.body;
  if (!table || !ids || !ids.length) return res.status(400).json({ success: false, message: 'Data tidak valid' });
  try {
      const { error } = await supabase.from(table).delete().in('id', ids);
      if (error) throw error;
      res.json({ success: true, message: `${ids.length} data berhasil dihapus.` });
  } catch(err) { 
      res.status(500).json({ success: false, message: err.message }); 
  }
});

// API BULK APPROVE PENDING (SC, NG, Shortage)
app.post('/api/bulk-approve', async (req, res) => {
  const { type, ids, approvedBy } = req.body; 
  if (!ids || !ids.length) return res.status(400).json({ success: false, message: 'Tidak ada data dipilih' });

  const tablePending = type === 'ng' ? 'data_ng_pending' : type === 'shortage' ? 'data_shortage_pending' : 'data_sc_pending';
  const tableHistory = type === 'ng' ? 'data_history_ng' : type === 'shortage' ? 'data_history_shortage' : null;

  let successCount = 0; 
  let errors = [];

  for (const id of ids) {
      try {
          const { data: item, error: errPending } = await supabase.from(tablePending).select('*').eq('id', id).single();
          if (errPending || !item) throw new Error(`Baris ID ${id} tidak ditemukan`);

          const { data: mRow } = await supabase.from('data_master').select('id, yp, ys').eq('pn', item.pn).eq('lokasi', item.lokasi).maybeSingle();
          
          if (mRow) {
              let newYP = Number(mRow.yp); let newYS = Number(mRow.ys);
              if(item.in_out === 'OUT') {
                  const reqYP = Number(item.yp) || 0; const reqYS = Number(item.ys) || 0;
                  if (newYP < reqYP) throw new Error(`Stok YP di Master tidak cukup (PN: ${item.pn})`);
                  if (newYS < reqYS) throw new Error(`Stok YS di Master tidak cukup (PN: ${item.pn})`);
                  newYP -= reqYP; newYS -= reqYS;
              } else if (item.in_out === 'IN') {
                  newYP += (Number(item.yp) || 0); newYS += (Number(item.ys) || 0);
              }
              await supabase.from('data_master').update({ yp: newYP, ys: newYS, total: newYP + newYS }).eq('id', mRow.id);
          } else if (item.in_out === 'OUT') {
              throw new Error(`Data Master ${item.pn} tidak ditemukan`);
          }

          // Insert ke History SC Master
          await supabase.from('data_history_sc').insert([{
              lokasi: item.lokasi, model: item.model, pn: item.pn, material: item.material, waktu: item.waktu, 
              odf: item.odf, yp: item.yp, ys: item.ys, in_out: item.in_out, keterangan: item.keterangan, 
              no_ro: item.no_ro, status: 'APPROVED', picker: item.picker || 'System', approval: approvedBy || 'Admin'
          }]);

          // Insert ke Spesifik History
          if (tableHistory) {
              await supabase.from(tableHistory).insert([{
                  lokasi: item.lokasi, model: item.model, pn: item.pn, material: item.material, waktu: item.waktu, 
                  odf: item.odf, yp: item.yp, ys: item.ys, in_out: item.in_out, keterangan: item.keterangan, 
                  no_ro: item.no_ro, picker: item.picker || 'System', approval: approvedBy || 'Admin'
              }]);
          }

          await supabase.from(tablePending).delete().eq('id', id);
          successCount++;
      } catch(e) { 
          errors.push(e.message); 
      }
  }

  if (successCount === 0) {
      res.status(400).json({ success: false, message: `Gagal semua: ${errors[0]}` });
  } else {
      res.json({ success: true, message: `Berhasil: ${successCount} baris. Gagal: ${errors.length} baris.` });
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
  
  const sessionPendingYP = {};
  const sessionPendingYS = {};

  try {
    for (const item of transactionItems) {
      const ypVal = parseInt(item.yp) || 0;
      const ysVal = parseInt(item.ys) || 0;
      const itemPicker = item.picker || defaultPicker; 
      
      // LOGIC KHUSUS NG PENDING
      if (item.keterangan === 'NG Pending') {
        await supabase.from('data_ng_pending').insert([{
            lokasi: item.lokasi, model: item.model, pn: item.pn, material: item.material, waktu: waktuSekarang, 
            odf: item.odf, yp: ypVal, ys: ysVal, in_out: item.type, keterangan: item.keterangan, 
            no_ro: item.noRo, status: 'PROSES', picker: itemPicker
        }]);
        continue; // Langsung ke item transaksi berikutnya (jangan jalankan logic IN/OUT standard di bawahnya)
      } else if (item.keterangan === 'Dipakai Shortage') {
        await supabase.from('data_shortage_pending').insert([{
            lokasi: item.lokasi, model: item.model, pn: item.pn, material: item.material, waktu: waktuSekarang, 
            odf: item.odf, yp: ypVal, ys: ysVal, in_out: item.type, keterangan: item.keterangan, 
            no_ro: item.noRo, status: 'PROSES', picker: itemPicker
        }]);
        continue;
      }

      if (item.type === 'IN') {
        const { data: mRow, error: findError } = await supabase
          .from('data_master')
          .select('id, yp, ys')
          .eq('pn', item.pn)
          .eq('lokasi', item.lokasi)
          .maybeSingle();

        if (findError) throw findError;

        if (mRow) {
          const newYP = Number(mRow.yp) + ypVal;
          const newYS = Number(mRow.ys) + ysVal;
          await supabase.from('data_master').update({ yp: newYP, ys: newYS, total: newYP + newYS }).eq('id', mRow.id);

          await supabase.from('data_history_sc').insert([{
              lokasi: item.lokasi, model: item.model, pn: item.pn, material: item.material, waktu: waktuSekarang, 
              odf: item.odf, yp: ypVal, ys: ysVal, in_out: 'IN', keterangan: item.keterangan, 
              no_ro: item.noRo, status: 'APPROVED', picker: itemPicker, approval: 'AUTO'
            }]);
        } else {
          errors.push(`Gagal IN: PN '${item.pn}' di Lokasi '${item.lokasi}' tidak terdaftar di Database Master.`);
        }
      } else {
        const { data: mRow, error: findError } = await supabase
          .from('data_master')
          .select('yp, ys')
          .eq('pn', item.pn)
          .eq('lokasi', item.lokasi)
          .maybeSingle();
        
        if (findError) throw findError;

        if (!mRow) {
          errors.push(`Gagal OUT: PN '${item.pn}' di Lokasi '${item.lokasi}' tidak ditemukan di Master.`);
          continue;
        }

        const { data: pendingRows, error: pendingError } = await supabase
          .from('data_sc_pending')
          .select('yp, ys')
          .eq('pn', item.pn)
          .eq('lokasi', item.lokasi);

        if (pendingError) throw pendingError;

        let totalPendingYP = 0;
        let totalPendingYS = 0;
        if (pendingRows) {
            pendingRows.forEach(p => {
                totalPendingYP += (parseInt(p.yp) || 0);
                totalPendingYS += (parseInt(p.ys) || 0);
            });
        }

        const key = `${item.pn}_${item.lokasi}`;
        const currentSessionYP = sessionPendingYP[key] || 0;
        const currentSessionYS = sessionPendingYS[key] || 0;

        const availableYP = Math.max(0, (parseInt(mRow.yp) || 0) - totalPendingYP - currentSessionYP);
        const availableYS = Math.max(0, (parseInt(mRow.ys) || 0) - totalPendingYS - currentSessionYS);

        if (ypVal > availableYP || ysVal > availableYS) {
            errors.push(`Gagal OUT: Baris '${item.pn}' - Melebihi ketersediaan. (Sisa Stok Available -> YP: ${availableYP}, YS: ${availableYS})`);
            continue;
        }

        sessionPendingYP[key] = currentSessionYP + ypVal;
        sessionPendingYS[key] = currentSessionYS + ysVal;

        await supabase.from('data_sc_pending').insert([{
            lokasi: item.lokasi, model: item.model, pn: item.pn, material: item.material, waktu: waktuSekarang, 
            odf: item.odf, yp: ypVal, ys: ysVal, in_out: 'OUT', keterangan: item.keterangan, 
            no_ro: item.noRo, status: 'PROSES', picker: itemPicker
          }]);
      }
    }
    
    if (errors.length > 0) {
      res.status(400).json({ success: false, message: errors.join('\n') });
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

app.get('/api/chart-summary', async (req, res) => {
  try {
    const { data, error } = await supabase.from('data_history_sc').select('keterangan');
    if (error) throw error;
    
    const summary = {};
    data.forEach(r => { 
      if (r.keterangan) summary[r.keterangan] = (summary[r.keterangan] || 0) + 1;
    });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/drilldown', async (req, res) => {
  const keterangan = req.query.keterangan;
  try {
    const { data: logsRows, error: errLogs } = await supabase.from('data_history_sc').select('lokasi, model, pn, material, waktu, yp, ys').eq('keterangan', keterangan).order('id', { ascending: false }).limit(30);
    if (errLogs) throw errLogs;

    const { data: allGroupData, error: errGroup } = await supabase.from('data_history_sc').select('material, yp, ys').eq('keterangan', keterangan);
    if (errGroup) throw errGroup;

    const materialGroups = {};
    (allGroupData || []).forEach(g => {
      const mat = g.material || '-';
      if (!materialGroups[mat]) materialGroups[mat] = { yp: 0, ys: 0 };
      materialGroups[mat].yp += (Number(g.yp) || 0);
      materialGroups[mat].ys += (Number(g.ys) || 0);
    });

    const formattedLogs = (logsRows || []).map(d => ({ ...d, waktu: d.waktu ? new Date(d.waktu).toLocaleString('id-ID') : '-' }));
    res.json({ recentLogs: formattedLogs, materialGroups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/item-history', async (req, res) => {
  try {
    const { data, error } = await supabase.from('data_history_sc').select('waktu, in_out, yp, ys, keterangan, no_ro').eq('pn', req.query.pn).eq('lokasi', req.query.lokasi).order('id', { ascending: false }).limit(20);
    if (error) throw error;
    const formatted = (data || []).map(d => ({ waktu: d.waktu ? new Date(d.waktu).toLocaleString('id-ID') : '-', type: d.in_out, yp: d.yp, ys: d.ys, keterangan: d.keterangan, noRo: d.no_ro }));
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
    if (search) query = query.or(`pn.ilike.%${search}%,model.ilike.%${search}%,no_ro.ilike.%${search}%`);

    const { data, count, error } = await query.range(offset, offset + pageSize - 1).order('id', { ascending: false });
    if (error) throw error;

    const formattedData = (data || []).map(d => ({ 
      ...d, rowNum: d.id, type: d.in_out, noRo: d.no_ro, waktu: d.waktu ? new Date(d.waktu).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-'
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