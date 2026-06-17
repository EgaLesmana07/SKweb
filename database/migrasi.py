import sqlite3
import csv

def migrasi_csv_sc_pending_ke_sqlite(file_csv, file_sqlite, nama_tabel):
    # 1. Buka koneksi ke SQLite
    koneksi = sqlite3.connect(file_sqlite)
    kursor = koneksi.cursor()

    # Daftar kolom sesuai dengan struktur header di file CSV SC Pending Anda
    # spasi diganti '_' dan '/' diganti '_' agar aman di database
    kolom_db = [
        'lokasi', 'model', 'pn', 'material', 'waktu', 'odf', 
        'yp', 'ys', 'in_out', 'keterangan', 'no_ro', 'status'
    ]

    # 2. Siapkan query INSERT
    # Menggunakan INSERT INTO biasa karena data pending biasanya berupa log/transaksi 
    # yang bisa memiliki PN yang sama berulang kali di waktu yang berbeda.
    placeholder = ', '.join(['?' for _ in kolom_db])
    kolom_string = ', '.join(kolom_db)
    query_insert = f"INSERT INTO {nama_tabel} ({kolom_string}) VALUES ({placeholder})"

    # 3. Buka dan baca file CSV menggunakan DictReader
    try:
        with open(file_csv, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            
            # Bersihkan header CSV: huruf kecil, ganti spasi dan garis miring dengan underscore (_)
            # Contoh: 'IN/OUT' -> 'in_out', 'No RO' -> 'no_ro'
            if reader.fieldnames:
                reader.fieldnames = [
                    name.strip().lower().replace('/', '_').replace(' ', '_') 
                    for name in reader.fieldnames
                ]
            
            data_batch = []
            
            for baris in reader:
                # Ambil data teks
                lokasi = baris.get('lokasi', '')
                model = baris.get('model', '')
                pn = baris.get('pn', '')
                material = baris.get('material', '')
                waktu = baris.get('waktu', '')
                odf = baris.get('odf', '')
                in_out = baris.get('in_out', '')
                keterangan = baris.get('keterangan', '')
                no_ro = baris.get('no_ro', '')
                status = baris.get('status', '')

                # Ambil data angka (#), jika kosong di CSV jadikan angka 0
                try:
                    yp = int(baris.get('yp', 0) or 0)
                except ValueError:
                    yp = 0
                    
                try:
                    ys = int(baris.get('ys', 0) or 0)
                except ValueError:
                    ys = 0

                # Gabungkan menjadi satu tuple sesuai urutan kolom_db
                data_tuple = (lokasi, model, pn, material, waktu, odf, yp, ys, in_out, keterangan, no_ro, status)
                data_batch.append(data_tuple)
            
            # 4. Masukkan data ke database
            kursor.executemany(query_insert, data_batch)

        # 5. Simpan perubahan
        koneksi.commit()
        print(f"✅ Migrasi berhasil! {len(data_batch)} baris data dimasukkan ke tabel '{nama_tabel}'")

    except FileNotFoundError:
        print(f"❌ Error: File CSV '{file_csv}' tidak ditemukan.")
    except sqlite3.OperationalError as e:
        print(f"❌ Error Database: {e}. Pastikan tabel '{nama_tabel}' benar-benar sudah ada dan memiliki kolom yang sesuai.")
    except Exception as e:
        print(f"❌ Terjadi kesalahan: {e}")
    finally:
        # Tutup koneksi
        koneksi.close()

# --- Cara Menjalankan ---
# Sesuaikan nama file CSV dan asumsikan nama tabel di database Anda adalah 'sc_pending'
migrasi_csv_sc_pending_ke_sqlite('DATA MASTER - BACKUP HISTORY SC 2025.csv', 'database_aplikasi.db', 'data_backup_history_25_26')