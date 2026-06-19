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

app.use(express.json({ limit: '10mb' })); // Menambah limit parser JSON untuk upload banyak item sekaligus
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- API LOGIN ---
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const { data, error } = await supabase
    .from('data_users')
    .select('*')
    .eq('username', username)
    .eq('password', password)
    .maybeSingle();

  if (error || !data) {
    return res.json({ success: false, message: 'Username atau Password salah!' });
  }
  res.json({ success: true, role: data.role, fullName: data.fullName, username: data.username });
});

// --- API REGISTRASI (SUPERADMIN ONLY) ---
app.post('/api/register', async (req, res) => {
  const { username, password, role, fullName } = req.body;
  
  if (!username || !password || !role || !fullName) {
      return res.status(400).json({ success: false, message: 'Semua kolom wajib diisi!' });
  }

  // Cek apakah username sudah ada
  const { data: existingUser } = await supabase
    .from('data_users')
    .select('username')
    .eq('username', username)
    .maybeSingle();

  if (existingUser) {
    return res.status(400).json({ success: false, message: 'Username sudah digunakan, silakan pilih yang lain!' });
  }

  const { error } = await supabase
    .from('data_users')
    .insert([{ username, password, role, fullName }]);

  if (error) return res.status(500).json({ success: false, message: 'Gagal membuat akun', error });
  res.json({ success: true, message: 'Akun berhasil didaftarkan!' });
});

// --- API UPDATE USER ---
app.put('/api/users/:rowNum', async (req, res) => {
  const rowNum = req.params.rowNum;
  const { username, password, role, fullName } = req.body;

  if (!username || !password || !role || !fullName) {
    return res.status(400).json({ success: false, message: 'Semua kolom wajib diisi!' });
  }

  // Cek username terduplikasi
  const { data: existingUser } = await supabase
    .from('data_users')
    .select('id')
    .eq('username', username)
    .neq('id', rowNum)
    .maybeSingle();

  if (existingUser) {
    return res.status(400).json({ success: false, message: 'Username sudah digunakan oleh akun lain!' });
  }

  const { error } = await supabase
    .from('data_users')
    .update({ username, password, role, fullName })
    .eq('id', rowNum);

  if (error) return res.status(500).json({ success: false, message: 'Gagal memperbarui data pengguna' });
  res.json({ success: true, message: 'Data pengguna berhasil diperbarui!' });
});

// --- API DELETE USER ---
app.delete('/api/users/:rowNum', async (req, res) => {
  const { error } = await supabase
    .from('data_users')
    .delete()
    .eq('id', req.params.rowNum);

  if (error) return res.status(500).json({ success: false, message: 'Gagal menghapus pengguna' });
  res.json({ success: true, message: 'Akun pengguna berhasil dihapus!' });
});

app.get('/api/users', async (req, res) => {
  const { data, error } = await supabase
    .from('data_users')
    .select('id, username, password, role, fullName')
    .order('id', { ascending: false });

  if (error) return res.status(500).json({ success: false, message: 'Gagal mengambil data pengguna' });
  
  const formattedData = data.map(u => ({ ...u, rowNum: u.id }));
  res.json({ success: true, data: formattedData });
});

// --- API AUTOCOMPLETE ---
app.get('/api/autocomplete', async (req, res) => {
  let allData = [];
  let pageNum = 0;
  const limitVal = 1000;

  while (true) {
    const { data: chunk, error } = await supabase
      .from('data_master')
      .select('lokasi, model, pn, description, yp, ys')
      .range(pageNum * limitVal, (pageNum + 1) * limitVal - 1);

    if (error) return res.status(500).json({ success: false, error: error.message });
    if (!chunk || chunk.length === 0) break;
    
    allData = allData.concat(chunk);
    if (chunk.length < limitVal) break;
    pageNum++;
  }

  res.json(allData);
});

// --- API DATABASE MASTER ---
app.get('/api/database', async (req, res) => {
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;
  const offset = (page - 1) * pageSize;

  let query = supabase.from('data_master').select('*', { count: 'exact' });

  if (search) {
    query = query.or(`lokasi.ilike.%${search}%,model.ilike.%${search}%,pn.ilike.%${search}%,description.ilike.%${search}%`);
  }

  const { data, count, error } = await query
    .range(offset, offset + pageSize - 1)
    .order('id', { ascending: false });

  if (error) return res.status(500).json({ success: false, error: error.message });

  let allModels = [];
  let pageNum = 0;
  const limitVal = 1000;
  while (true) {
    const { data: chunk, error: chunkErr } = await supabase
      .from('data_master')
      .select('model')
      .range(pageNum * limitVal, (pageNum + 1) * limitVal - 1);
    
    if (chunkErr || !chunk || chunk.length === 0) break;
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
});

// --- API BATCH IMPORT DATABASE MASTER FROM CSV ---
app.post('/api/database/batch', async (req, res) => {
  const { items } = req.body;
  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Data CSV kosong atau tidak valid!' });
  }

  try {
    const recordsToInsert = [];
    const recordsToUpdate = [];

    // Validasi data and siapkan query
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

      // Periksa apakah item dengan PN dan Lokasi yang sama sudah terdaftar
      const { data: existingItem, error: checkError } = await supabase
        .from('data_master')
        .select('id, yp, ys')
        .eq('pn', pn)
        .eq('lokasi', lokasi)
        .maybeSingle();

      if (checkError) throw checkError;

      if (existingItem) {
        // Jika sudah ada, lakukan update stok (bisa ditambahkan / ditimpa. Di sini ditimpa sesuai nilai CSV)
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
        // Jika belum ada, masukkan data baru
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

    // Eksekusi insert massal ke database
    if (recordsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('data_master')
        .insert(recordsToInsert);
      
      if (insertError) throw insertError;
    }

    // Eksekusi update satu per satu secara sinkronus atau batch
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
      message: 'Batch Import berhasil!', 
      count: recordsToInsert.length + recordsToUpdate.length,
      inserted: recordsToInsert.length,
      updated: recordsToUpdate.length
    });

  } catch (error) {
    console.error("Batch Database Master Error:", error);
    res.status(500).json({ success: false, message: 'Gagal mengimpor database master', error: error.message });
  }
});

app.post('/api/database', async (req, res) => {
  const { lokasi, model, pn, pn1, description, yp, ys } = req.body;
  const ypVal = parseInt(yp) || 0;
  const ysVal = parseInt(ys) || 0;

  const { data, error } = await supabase
    .from('data_master')
    .insert([{ lokasi, model, pn, pn1, description, yp: ypVal, ys: ysVal, total: ypVal + ysVal }])
    .select('id')
    .single();

  if (error) return res.status(500).json({ success: false, message: 'Gagal menambah data master', error });
  res.json({ success: true, rowNum: data.id });
});

app.put('/api/database/:rowNum', async (req, res) => {
  const { lokasi, model, pn, pn1, description, yp, ys } = req.body;
  const ypVal = parseInt(yp) || 0;
  const ysVal = parseInt(ys) || 0;

  const { error } = await supabase
    .from('data_master')
    .update({ lokasi, model, pn, pn1, description, yp: ypVal, ys: ysVal, total: ypVal + ysVal })
    .eq('id', req.params.rowNum);

  if (error) return res.status(500).json({ success: false, message: 'Gagal memperbarui data master', error });
  res.json({ success: true });
});

app.delete('/api/database/:rowNum', async (req, res) => {
  const { error } = await supabase
    .from('data_master')
    .delete()
    .eq('id', req.params.rowNum);

  if (error) return res.status(500).json({ success: false, message: 'Gagal menghapus data master' });
  res.json({ success: true });
});

// --- API HISTORY SC ---
app.get('/api/history', async (req, res) => {
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;
  const offset = (page - 1) * pageSize;

  let query = supabase.from('data_history_sc').select('*', { count: 'exact' });

  if (search) {
    query = query.or(`pn.ilike.%${search}%,model.ilike.%${search}%,lokasi.ilike.%${search}%,keterangan.ilike.%${search}%,no_ro.ilike.%${search}%,picker.ilike.%${search}%,approval.ilike.%${search}%`);
  }

  const { data, count, error } = await query
    .range(offset, offset + pageSize - 1)
    .order('id', { ascending: false });

  if (error) return res.status(500).json({ success: false, error: error.message });

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
});

app.put('/api/history/:rowNum', async (req, res) => {
  const { lokasi, model, pn, material, waktu, odf, yp, ys, type, keterangan, noRo, picker, approval } = req.body;
  
  const { error } = await supabase
    .from('data_history_sc')
    .update({ 
      lokasi, model, pn, material, waktu, odf, 
      yp: Number(yp)||0, ys: Number(ys)||0, in_out: type, keterangan, no_ro: noRo, picker, approval 
    })
    .eq('id', req.params.rowNum);

  if (error) return res.status(500).json({ success: false, message: 'Gagal memperbarui log history', error });
  res.json({ success: true });
});

app.delete('/api/history/:rowNum', async (req, res) => {
  const rowNum = req.params.rowNum;

  const { data: item, error: errItem } = await supabase
    .from('data_history_sc')
    .select('*')
    .eq('id', rowNum)
    .single();

  if (errItem || !item) return res.status(504).json({ success: false, message: 'Data history tidak ditemukan' });

  const multiplier = (item.in_out === 'IN') ? -1 : 1;
  const ypChange = (Number(item.yp) || 0) * multiplier;
  const ysChange = (Number(item.ys) || 0) * multiplier;

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

  await supabase.from('data_history_sc').delete().eq('id', rowNum);
  res.json({ success: true });
});

// --- API PENDING SC ---
app.get('/api/pending', async (req, res) => {
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;
  const offset = (page - 1) * pageSize;

  let query = supabase.from('data_sc_pending').select('*', { count: 'exact' });

  if (search) {
    query = query.or(`pn.ilike.%${search}%,model.ilike.%${search}%,lokasi.ilike.%${search}%,keterangan.ilike.%${search}%,picker.ilike.%${search}%`);
  }

  const { data, count, error } = await query
    .range(offset, offset + pageSize - 1)
    .order('id', { ascending: false });

  if (error) return res.status(500).json({ success: false, error: error.message });

  const formattedData = data.map(d => ({ 
    ...d, 
    rowNum: d.id, 
    type: d.in_out, 
    noRo: d.no_ro,
    waktu: d.waktu ? new Date(d.waktu).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-'
  }));

  res.json({ success: true, data: formattedData, totalPages: Math.ceil(count / pageSize), currentPage: page, totalItems: count });
});

app.delete('/api/pending/:rowNum', async (req, res) => {
  const { error } = await supabase
    .from('data_sc_pending')
    .delete()
    .eq('id', req.params.rowNum);

  if (error) return res.status(500).json({ success: false, message: 'Gagal membatalkan transaksi pending' });
  res.json({ success: true });
});

app.post('/api/pending/approve/:rowNum', async (req, res) => {
  const rowNum = req.params.rowNum;
  const { approvedBy } = req.body; 

  const { data: item, error: errPending } = await supabase
    .from('data_sc_pending')
    .select('*')
    .eq('id', rowNum)
    .single();

  if (errPending || !item) return res.status(504).json({ success: false, message: 'Data pending tidak ditemukan' });

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

  const { error: errUp } = await supabase
    .from('data_master')
    .update({ yp: newYP, ys: newYS, total: newTotal })
    .eq('id', mRow.id);

  if (errUp) return res.status(500).json({ success: false, message: 'Gagal memperbarui stok di master' });

  const { error: errHist } = await supabase
    .from('data_history_sc')
    .insert([{
      lokasi: item.lokasi, model: item.model, pn: item.pn, material: item.material, waktu: item.waktu, 
      odf: item.odf, yp: item.yp, ys: item.ys, in_out: item.in_out, keterangan: item.keterangan, 
      no_ro: item.no_ro, status: 'APPROVED', picker: item.picker || 'System', approval: approvedBy || 'Admin'
    }]);

  if (errHist) return res.status(500).json({ success: false, message: 'Gagal memindahkan ke log history' });

  await supabase.from('data_sc_pending').delete().eq('id', rowNum);
  res.json({ success: true });
});

// --- API TRANSAKSI BATCH ---
app.post('/api/transactions/batch', async (req, res) => {
  const { items, picker } = req.body; 
  const transactionItems = items || req.body; 
  const defaultPicker = picker || 'System';

  if (!transactionItems || transactionItems.length === 0) return res.status(400).json({ success: false, message: 'Item transaksi kosong' });

  const waktuSekarang = new Date().toISOString();
  let errors = [];

  for (const item of transactionItems) {
    const ypVal = parseInt(item.yp) || 0;
    const ysVal = parseInt(item.ys) || 0;
    const itemPicker = item.picker || defaultPicker; 

    if (item.type === 'IN') {
      const { data: mRow } = await supabase
        .from('data_master')
        .select('id, yp, ys')
        .eq('pn', item.pn)
        .eq('lokasi', item.lokasi)
        .maybeSingle();

      if (mRow) {
        const newYP = Number(mRow.yp) + ypVal;
        const newYS = Number(mRow.ys) + ysVal;
        await supabase
          .from('data_master')
          .update({ yp: newYP, ys: newYS, total: newYP + newYS })
          .eq('id', mRow.id);

        await supabase
          .from('data_history_sc')
          .insert([{
            lokasi: item.lokasi, model: item.model, pn: item.pn, material: item.material, waktu: waktuSekarang, 
            odf: item.odf, yp: ypVal, ys: ysVal, in_out: 'IN', keterangan: item.keterangan, 
            no_ro: item.noRo, status: 'APPROVED', picker: itemPicker, approval: 'AUTO'
          }]);
      } else {
        errors.push(`Gagal IN: PN '${item.pn}' di Lokasi '${item.lokasi}' tidak ditemukan di Database Master. Tambahkan dari menu Database terlebih dahulu`);
      }
    } else {
      await supabase
        .from('data_sc_pending')
        .insert([{
          lokasi: item.lokasi, model: item.model, pn: item.pn, material: item.material, waktu: waktuSekarang, 
          odf: item.odf, yp: ypVal, ys: ysVal, in_out: 'OUT', keterangan: item.keterangan, 
          no_ro: item.noRo, status: 'PROSES', picker: itemPicker
        }]);
    }
  }
  
  if (errors.length > 0) res.status(500).json({ success: false, message: errors.join('. ') });
  else res.json({ success: true });
});

// --- API CHART & DRILLDOWN ---
app.get('/api/chart-summary', async (req, res) => {
  const { data, error } = await supabase
    .from('data_history_sc')
    .select('keterangan');

  if (error) return res.status(500).json({ success: false, error: error.message });
  
  const summary = {};
  data.forEach(r => { 
    if (r.keterangan) {
      summary[r.keterangan] = (summary[r.keterangan] || 0) + 1;
    }
  });
  res.json(summary);
});

app.get('/api/drilldown', async (req, res) => {
  const keterangan = req.query.keterangan;
  
  const { data: logsRows } = await supabase
    .from('data_history_sc')
    .select('lokasi, model, pn, material, waktu, yp, ys')
    .eq('keterangan', keterangan)
    .order('id', { ascending: false })
    .limit(30);

  const { data: allGroupData } = await supabase
    .from('data_history_sc')
    .select('material, yp, ys')
    .eq('keterangan', keterangan);

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
});

app.get('/api/item-history', async (req, res) => {
  const { data, error } = await supabase
    .from('data_history_sc')
    .select('waktu, in_out, yp, ys, keterangan, no_ro')
    .eq('pn', req.query.pn)
    .eq('lokasi', req.query.lokasi)
    .order('id', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ success: false, error: error.message });

  const formatted = (data || []).map(d => ({
    waktu: d.waktu ? new Date(d.waktu).toLocaleString('id-ID') : '-',
    type: d.in_out,
    yp: d.yp,
    ys: d.ys,
    keterangan: d.keterangan,
    noRo: d.no_ro
  }));

  res.json(formatted);
});

// --- API BACKUP ---
app.get('/api/backup', async (req, res) => {
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;
  const offset = (page - 1) * pageSize;

  let query = supabase.from('data_backup_history_25_26').select('*', { count: 'exact' });

  if (search) {
    query = query.or(`pn.ilike.%${search}%,model.ilike.%${search}%,no_ro.ilike.%${search}%`);
  }

  const { data, count, error } = await query
    .range(offset, offset + pageSize - 1)
    .order('id', { ascending: false });
  
  if (error) return res.json({ success: true, data: [], totalPages: 0, currentPage: 1, totalItems: 0 });

  const formattedData = (data || []).map(d => ({ 
    ...d, 
    rowNum: d.id, 
    type: d.in_out, 
    noRo: d.no_ro,
    waktu: d.waktu ? new Date(d.waktu).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-'
  }));

  res.json({ success: true, data: formattedData, totalPages: Math.ceil(count / pageSize), currentPage: page, totalItems: count });
});

app.listen(PORT, () => {
  console.log(`🚀 Server aktif menggunakan Supabase di port http://localhost:${PORT}`);
});
// Tambahkan baris ini untuk Vercel
module.exports = app;